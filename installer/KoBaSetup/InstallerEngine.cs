using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace KoBa.Setup;

internal sealed record MigrationRecord(string OriginalPath, string BackupPath, string TargetPath, string CompletedAt);
internal sealed record PendingMove(string OriginalPath, string BackupPath, string TargetPath);
internal sealed record ReleaseInfo(string Version, string ArchiveUrl, string SumUrl, string? GitHubDigest, long Size);

internal sealed class InstallerEngine
{
    private static readonly string[] RuntimeFiles =
    {
        "LICENSE", "background.js", "content.js", "lib.js", "manifest.json", "migration.js",
        "options.html", "options.js", "panel.js", "session.js", "updates.js"
    };
    private const long MaxArchiveBytes = 25 * 1024 * 1024;
    private const long MaxExtractedBytes = 25 * 1024 * 1024;
    private static readonly Uri LatestRelease = new("https://api.github.com/repos/kurichon/koba/releases/latest");
    private readonly HttpClient http;
    public string RootDirectory { get; }
    public string ExtensionDirectory => Path.Combine(RootDirectory, "Extension");
    private string MigrationMarker => Path.Combine(RootDirectory, "migration-prepared.json");
    private string MigrationPending => Path.Combine(RootDirectory, "migration-pending.json");
    private string UpdatePending => Path.Combine(RootDirectory, "update-pending.json");
    public bool IsMigrationPrepared => File.Exists(MigrationMarker);

    internal InstallerEngine(string? rootDirectory = null, HttpClient? client = null)
    {
        RootDirectory = Path.GetFullPath(rootDirectory ??
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KoBa"));
        http = client ?? new HttpClient { Timeout = TimeSpan.FromSeconds(40) };
        if (!http.DefaultRequestHeaders.UserAgent.Any())
            http.DefaultRequestHeaders.UserAgent.ParseAdd("KoBa-Windows-Setup/1.0");
        if (!http.DefaultRequestHeaders.Accept.Any())
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    public string? GetInstalledVersion()
    {
        var manifest = Path.Combine(ExtensionDirectory, "manifest.json");
        return File.Exists(manifest) ? ReadManifestVersion(ExtensionDirectory) : null;
    }

    public static bool BrowserRunning() =>
        Process.GetProcessesByName("chrome").Length > 0 || Process.GetProcessesByName("brave").Length > 0;

    public static void RequireBrowsersClosed()
    {
        if (BrowserRunning())
            throw new InvalidOperationException("Close all Chrome and Brave processes before changing KoBa's files. " +
                "If background processes remain after closing the windows, exit Chrome/Brave completely and retry. " +
                "A pending JPDB grade must be resolved before closing the browser.");
    }

    public async Task<string> InstallLatestAsync(CancellationToken cancellationToken = default)
    {
        PrepareRoot();
        RecoverInterruptedUpdate();
        RecoverInterruptedMigration();
        var info = await GetLatestReleaseAsync(cancellationToken);
        var installed = GetInstalledVersion();
        if (installed is not null && CompareVersions(installed, info.Version) >= 0) return installed;

        var temp = Path.Combine(RootDirectory, "Staging", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            var sumBytes = await DownloadBoundedAsync(info.SumUrl, 1024, cancellationToken);
            var sums = Encoding.UTF8.GetString(sumBytes).TrimEnd('\r', '\n');
            var exactLine = Regex.Match(sums, @"^([0-9a-f]{64})  (KoBa_v[0-9]+(?:\.[0-9]+){2,3}\.zip)$");
            var filename = "KoBa_v" + info.Version + ".zip";
            if (!exactLine.Success || exactLine.Groups[2].Value != filename)
                throw new InvalidDataException("Release checksum file must contain one entry for the exact KoBa ZIP.");
            var expected = exactLine.Groups[1].Value;
            if (info.GitHubDigest is not null && info.GitHubDigest != "sha256:" + expected)
                throw new InvalidDataException("GitHub asset digest and checksum file disagree.");

            var archive = Path.Combine(temp, filename);
            var zipBytes = await DownloadBoundedAsync(info.ArchiveUrl, MaxArchiveBytes, cancellationToken);
            if (zipBytes.LongLength != info.Size)
                throw new InvalidDataException("Downloaded ZIP size does not match the release metadata.");
            await File.WriteAllBytesAsync(archive, zipBytes, cancellationToken);
            return InstallVerifiedPackage(archive, info.Version, expected);
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, recursive: true); }
    }

    internal string InstallVerifiedPackage(string archivePath, string version, string expectedSha256,
                                           bool requireClosedBrowsers = true)
    {
        PrepareRoot();
        RecoverInterruptedUpdate(requireClosedBrowsers);
        var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(archivePath))).ToLowerInvariant();
        if (actual != expectedSha256)
            throw new InvalidDataException("KoBa ZIP does not match the signed-off SHA-256 checksum.");
        if (!ValidVersion(version)) throw new InvalidDataException("Unsupported KoBa version.");
        var installed = GetInstalledVersion();
        if (Directory.Exists(ExtensionDirectory) && installed is null)
            throw new InvalidDataException("The AppData extension folder exists but is not a valid KoBa installation. No files were changed.");
        if (installed is not null && CompareVersions(installed, version) >= 0) return installed;
        var stage = Path.Combine(RootDirectory, "Staging", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        try
        {
            ExtractReviewedZip(archivePath, stage, version);
            if (installed is not null && requireClosedBrowsers) RequireBrowsersClosed();
            if (Directory.Exists(ExtensionDirectory))
            {
                var backup = Path.Combine(RootDirectory, "Backups",
                    installed + "-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(Path.GetDirectoryName(backup)!);
                WriteJsonAtomically(UpdatePending, new PendingMove(ExtensionDirectory, backup, stage));
                try
                {
                    Directory.Move(ExtensionDirectory, backup);
                    Directory.Move(stage, ExtensionDirectory);
                    if (ReadManifestVersion(ExtensionDirectory) != version)
                        throw new InvalidDataException("Installed manifest verification failed after replacing the extension.");
                    File.Delete(UpdatePending);
                }
                catch
                {
                    if (!Directory.Exists(ExtensionDirectory) && Directory.Exists(backup))
                        Directory.Move(backup, ExtensionDirectory);
                    if (Directory.Exists(ExtensionDirectory) && ReadManifestVersion(ExtensionDirectory) == installed)
                        File.Delete(UpdatePending);
                    throw;
                }
            }
            else
            {
                Directory.Move(stage, ExtensionDirectory);
            }
            return version;
        }
        finally { if (Directory.Exists(stage)) Directory.Delete(stage, recursive: true); }
    }

    // This is only the preparation for a ONE-TIME browser-data transfer. A real
    // directory remains at the old path so the old extension can export its
    // chrome.storage.local data before a new AppData-based extension is loaded.
    // Never replace the old path with a symlink/junction: Chromium can change
    // the unpacked extension ID when it resolves a linked path.
    public MigrationRecord PrepareMigrationOnce(string sourcePath)
    {
        PrepareRoot();
        RecoverInterruptedMigration();
        if (IsMigrationPrepared)
            throw new InvalidOperationException("The old extension was already prepared. Export its data from KoBa Options instead of preparing again.");
        var version = GetInstalledVersion();
        if (version is null || CompareVersions(version, "0.3.8") < 0)
            throw new InvalidOperationException("The official AppData KoBa installation must be v0.3.8 or newer before the one-time export can be prepared.");
        RequireBrowsersClosed();
        var old = Path.GetFullPath(sourcePath).TrimEnd(Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(ExtensionDirectory);
        if (SamePath(old, target) || IsWithin(old, RootDirectory) || IsWithin(target, old) ||
            old.StartsWith(@"\\", StringComparison.Ordinal) || old.Contains('%') || old.Contains('!'))
            throw new InvalidOperationException("Select the existing local unpacked KoBa extension folder outside AppData.");
        if (!Directory.Exists(old) || IsReparse(old) ||
            ReadManifestVersion(old) is null || !File.Exists(Path.Combine(old, "background.js")))
            throw new InvalidOperationException("Select a real KoBa folder containing manifest.json and background.js.");
        var backup = old + ".KoBa-original-backup-" + Guid.NewGuid().ToString("N");
        var stage = old + ".KoBa-prep-stage-" + Guid.NewGuid().ToString("N");
        if (Directory.Exists(backup) || Directory.Exists(stage))
            throw new IOException("A migration work folder already exists.");
        try
        {
            Directory.CreateDirectory(stage);
            foreach (var name in RuntimeFiles)
                File.Copy(Path.Combine(ExtensionDirectory, name), Path.Combine(stage, name));
            if (ReadManifestVersion(stage) != version)
                throw new InvalidDataException("Prepared extension differs from the verified AppData release.");

            WriteJsonAtomically(MigrationPending, new PendingMove(old, backup, stage));
            try
            {
                Directory.Move(old, backup);
                Directory.Move(stage, old); // regular folder at EXACT original browser path
                if (ReadManifestVersion(old) != version || IsReparse(old))
                    throw new InvalidDataException("Original-path preparation failed verification.");
                var record = new MigrationRecord(old, backup, target, DateTimeOffset.UtcNow.ToString("O"));
                WriteJsonAtomically(MigrationMarker, record);
                File.Delete(MigrationPending);
                return record;
            }
            catch
            {
                if (!Directory.Exists(old) && Directory.Exists(backup))
                    Directory.Move(backup, old);
                // If stage became the real old directory, preserve it for inspection.
                // Never overwrite the original backup if rollback cannot finish.
                throw;
            }
        }
        finally
        {
            if (Directory.Exists(stage) && !IsReparse(stage)) Directory.Delete(stage, recursive: true);
        }
    }

    public void RollbackMigrationPreparation()
    {
        PrepareRoot();
        RecoverInterruptedMigration();
        if (!IsMigrationPrepared)
            throw new InvalidOperationException("No prepared old extension directory is recorded.");
        var record = ReadJson<MigrationRecord>(MigrationMarker)!;
        if (!SamePath(record.TargetPath, ExtensionDirectory) ||
            !Directory.Exists(record.OriginalPath) || IsReparse(record.OriginalPath) ||
            ReadManifestVersion(record.OriginalPath) is null ||
            !Directory.Exists(record.BackupPath) || IsReparse(record.BackupPath) ||
            ReadManifestVersion(record.BackupPath) is null)
            throw new InvalidDataException("Prepared directory or retained backup changed; no rollback attempted.");
        RequireBrowsersClosed();
        var preparedCopy = record.OriginalPath + ".KoBa-prepared-copy-" + Guid.NewGuid().ToString("N");
        Directory.Move(record.OriginalPath, preparedCopy);
        try
        {
            Directory.Move(record.BackupPath, record.OriginalPath);
            File.Delete(MigrationMarker);
        }
        catch
        {
            if (!Directory.Exists(record.OriginalPath))
                Directory.Move(preparedCopy, record.OriginalPath);
            throw;
        }
        // Do not discard the prepared copy automatically: it is a recovery artifact.
    }

    public void SaveUpdaterCopy()
    {
        PrepareRoot();
        var source = Environment.ProcessPath;
        if (source is null || !File.Exists(source)) return;
        var destination = Path.Combine(RootDirectory, "KoBaSetup.exe");
        if (!SamePath(source, destination)) File.Copy(source, destination, overwrite: true);
    }

    private void PrepareRoot()
    {
        Directory.CreateDirectory(RootDirectory);
        if (IsReparse(RootDirectory) || IsReparse(ExtensionDirectory))
            throw new InvalidOperationException("KoBa's AppData directories must be real directories, not junctions or symlinks.");
    }

    private void RecoverInterruptedUpdate(bool requireClosedBrowsers = true)
    {
        var state = ReadJson<PendingMove>(UpdatePending);
        if (state is null) return;
        if (!SamePath(state.OriginalPath, ExtensionDirectory) || !IsWithin(state.BackupPath, RootDirectory) ||
            !IsWithin(state.TargetPath, RootDirectory) ||
            !Path.GetFileName(Path.GetDirectoryName(state.BackupPath)!)!.Equals("Backups", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Update recovery record is invalid; no paths were modified.");
        if (Directory.Exists(ExtensionDirectory) && ReadManifestVersion(ExtensionDirectory) is not null)
        {
            File.Delete(UpdatePending); // Either the swap finished or it never began.
            return;
        }
        if (Directory.Exists(state.BackupPath) && !Directory.Exists(ExtensionDirectory))
        {
            if (requireClosedBrowsers) RequireBrowsersClosed();
            if (ReadManifestVersion(state.BackupPath) is null || IsReparse(state.BackupPath))
                throw new InvalidDataException("Update backup is invalid; recovery needs manual inspection.");
            Directory.Move(state.BackupPath, ExtensionDirectory);
            File.Delete(UpdatePending);
            return;
        }
        throw new InvalidDataException("Interrupted update needs inspection; the original files were not discarded.");
    }

    private void RecoverInterruptedMigration()
    {
        var state = ReadJson<PendingMove>(MigrationPending);
        if (state is null) return;
        var old = Path.GetFullPath(state.OriginalPath);
        var backup = Path.GetFullPath(state.BackupPath);
        var stage = Path.GetFullPath(state.TargetPath);
        // A corrupt or tampered journal must not let an updater move arbitrary paths.
        if (SamePath(old, ExtensionDirectory) || IsWithin(old, RootDirectory) ||
            !backup.StartsWith(old + ".KoBa-original-backup-", StringComparison.OrdinalIgnoreCase) ||
            !stage.StartsWith(old + ".KoBa-prep-stage-", StringComparison.OrdinalIgnoreCase) ||
            backup.Length > old.Length + 80 || stage.Length > old.Length + 80)
            throw new InvalidDataException("Migration journal paths are not recognized.");
        RequireBrowsersClosed();
        if (Directory.Exists(backup) && !IsReparse(backup) && ReadManifestVersion(backup) is not null)
        {
            if (!Directory.Exists(old))
            {
                Directory.Move(backup, old);
                File.Delete(MigrationPending);
                return;
            }
            if (!IsReparse(old) && ReadManifestVersion(old) is not null)
            {
                WriteJsonAtomically(MigrationMarker,
                    new MigrationRecord(old, backup, ExtensionDirectory, DateTimeOffset.UtcNow.ToString("O")));
                File.Delete(MigrationPending);
                return;
            }
            throw new InvalidDataException("Original extension folder changed after backup; inspect before retrying.");
        }
        if (Directory.Exists(old) && !IsReparse(old) && ReadManifestVersion(old) is not null &&
            !Directory.Exists(backup))
        {
            File.Delete(MigrationPending); // preparation stopped before moving the original
            return;
        }
        throw new InvalidDataException("Cannot safely recover interrupted migration; no files were overwritten.");
    }

    private async Task<ReleaseInfo> GetLatestReleaseAsync(CancellationToken cancellationToken)
    {
        var metadata = await DownloadBoundedAsync(LatestRelease.ToString(), 256 * 1024, cancellationToken);
        using var doc = JsonDocument.Parse(metadata);
        var release = doc.RootElement;
        if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean() ||
            release.GetProperty("published_at").ValueKind != JsonValueKind.String)
            throw new InvalidDataException("The latest KoBa release is not a published stable release.");
        var tag = release.GetProperty("tag_name").GetString() ?? "";
        if (!tag.StartsWith('v') || !ValidVersion(tag[1..]))
            throw new InvalidDataException("Unexpected GitHub release version.");
        var version = tag[1..];
        if (release.GetProperty("html_url").GetString() != "https://github.com/kurichon/koba/releases/tag/" + tag)
            throw new InvalidDataException("The GitHub release page is not the official KoBa repository.");
        var zipName = "KoBa_v" + version + ".zip";
        JsonElement? zip = null, sums = null;
        foreach (var asset in release.GetProperty("assets").EnumerateArray())
        {
            if (asset.GetProperty("state").GetString() != "uploaded") continue;
            var name = asset.GetProperty("name").GetString();
            if (name == zipName) zip = asset;
            if (name == "SHA256SUMS.txt") sums = asset;
        }
        if (zip is null || sums is null) throw new InvalidDataException("KoBa ZIP or SHA256SUMS.txt is missing.");
        var size = zip.Value.GetProperty("size").GetInt64();
        if (size <= 0 || size > MaxArchiveBytes)
            throw new InvalidDataException("GitHub release package size is invalid.");
        string GetUrl(JsonElement asset, string filename)
        {
            var value = asset.GetProperty("browser_download_url").GetString()!;
            var expected = "https://github.com/kurichon/koba/releases/download/" + tag + "/" + filename;
            if (value != expected) throw new InvalidDataException("GitHub asset URL is not the expected official download.");
            return value;
        }
        string? digest = null;
        if (zip.Value.TryGetProperty("digest", out var digestElement) && digestElement.ValueKind == JsonValueKind.String)
            digest = digestElement.GetString();
        return new ReleaseInfo(version, GetUrl(zip.Value, zipName),
            GetUrl(sums.Value, "SHA256SUMS.txt"), digest, size);
    }

    private async Task<byte[]> DownloadBoundedAsync(string url, long maxBytes, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maxBytes)
            throw new InvalidDataException("KoBa download exceeded its expected maximum size.");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var memory = new MemoryStream();
        var buffer = new byte[32768];
        long count = 0;
        while (true)
        {
            var read = await stream.ReadAsync(buffer, ct);
            if (read == 0) break;
            count += read;
            if (count > maxBytes) throw new InvalidDataException("KoBa download exceeded its size limit.");
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }

    private static void ExtractReviewedZip(string archive, string stage, string version)
    {
        using var file = ZipFile.OpenRead(archive);
        var expected = new HashSet<string>(RuntimeFiles, StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        if (file.Entries.Count != RuntimeFiles.Length)
            throw new InvalidDataException("KoBa ZIP does not contain exactly eleven reviewed runtime files.");
        foreach (var entry in file.Entries)
        {
            if (!expected.Contains(entry.FullName) || !seen.Add(entry.FullName) ||
                entry.FullName.Contains('/') || entry.FullName.Contains('\\'))
                throw new InvalidDataException("KoBa ZIP contains an unexpected or duplicate entry.");
            var unixType = (entry.ExternalAttributes >> 16) & 0xF000;
            if (unixType != 0 && unixType != 0x8000)
                throw new InvalidDataException("KoBa ZIP contains an unsupported file type.");
            total += entry.Length;
            if (entry.Length > 10 * 1024 * 1024 || total > MaxExtractedBytes)
                throw new InvalidDataException("KoBa ZIP expands beyond the safe size limit.");
            entry.ExtractToFile(Path.Combine(stage, entry.FullName), overwrite: false);
        }
        if (!seen.SetEquals(expected) || ReadManifestVersion(stage) != version)
            throw new InvalidDataException("KoBa ZIP manifest or runtime files are invalid.");
    }

    private static string? ReadManifestVersion(string directory)
    {
        var file = Path.Combine(directory, "manifest.json");
        if (!File.Exists(file)) return null;
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var manifest = doc.RootElement;
        var name = manifest.GetProperty("name").GetString();
        var version = manifest.GetProperty("version").GetString();
        return name == "KoBa" && manifest.GetProperty("manifest_version").GetInt32() == 3 &&
            ValidVersion(version) ? version : null;
    }

    private static bool ValidVersion(string? version) =>
        version is not null && Regex.IsMatch(version, @"^\d{1,5}\.\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$") &&
        version.Split('.').All(s => int.TryParse(s, out var n) && n <= 65535);

    private static int CompareVersions(string a, string b)
    {
        var aa = a.Split('.').Select(int.Parse).ToArray();
        var bb = b.Split('.').Select(int.Parse).ToArray();
        for (var i = 0; i < Math.Max(aa.Length, bb.Length); i++)
        {
            var delta = (i < aa.Length ? aa[i] : 0).CompareTo(i < bb.Length ? bb[i] : 0);
            if (delta != 0) return delta;
        }
        return 0;
    }

    private static bool IsReparse(string path) =>
        Directory.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;

    private static bool SamePath(string left, string right) =>
        Path.GetFullPath(left).TrimEnd('\\').Equals(Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

    private static bool IsWithin(string path, string directory) =>
        Path.GetFullPath(path).StartsWith(Path.GetFullPath(directory).TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);

    private static T? ReadJson<T>(string path) where T : class =>
        File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path)) : null;

    private static void WriteJsonAtomically<T>(string path, T value)
    {
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(value));
            File.Move(temp, path, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
