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
        "LICENSE", "background.js", "content.js", "lib.js", "manifest.json",
        "options.html", "options.js", "panel.js", "session.js", "updates.js"
    };
    private const long MaxArchiveBytes = 25 * 1024 * 1024;
    private const long MaxExtractedBytes = 25 * 1024 * 1024;
    private static readonly Uri LatestRelease = new("https://api.github.com/repos/kurichon/koba/releases/latest");
    private readonly HttpClient http;
    public string RootDirectory { get; }
    public string ExtensionDirectory => Path.Combine(RootDirectory, "Extension");
    private string MigrationMarker => Path.Combine(RootDirectory, "migration-completed.json");
    private string MigrationPending => Path.Combine(RootDirectory, "migration-pending.json");
    private string UpdatePending => Path.Combine(RootDirectory, "update-pending.json");
    public bool IsMigrationCompleted => File.Exists(MigrationMarker);

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

    public MigrationRecord MigrateOnce(string sourcePath)
    {
        PrepareRoot();
        RecoverInterruptedMigration();
        if (IsMigrationCompleted) throw new InvalidOperationException("This installation has already completed its one-time migration.");
        if (!Directory.Exists(ExtensionDirectory) || GetInstalledVersion() is null)
            throw new InvalidOperationException("Install the verified KoBa release under AppData before migrating.");
        RequireBrowsersClosed();
        var old = Path.GetFullPath(sourcePath).TrimEnd(Path.DirectorySeparatorChar);
        var target = Path.GetFullPath(ExtensionDirectory);
        if (old.Equals(target, StringComparison.OrdinalIgnoreCase) ||
            IsWithin(old, RootDirectory) || IsWithin(target, old) ||
            old.StartsWith(@"\\", StringComparison.Ordinal) ||
            old.Contains('%') || old.Contains('!'))
            throw new InvalidOperationException("Choose the original local KoBa unpacked-extension folder, not AppData or a redirected path.");
        if (!Directory.Exists(old) || IsReparse(old))
            throw new InvalidOperationException("The source must be a real existing KoBa directory, not a symlink or junction.");
        if (ReadManifestVersion(old) is null || !File.Exists(Path.Combine(old, "background.js")))
            throw new InvalidOperationException("The selected directory is not a supported KoBa extension. Nothing was moved.");
        var backup = old + ".KoBa-backup-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        if (Directory.Exists(backup))
            throw new InvalidOperationException("A migration backup already exists with the chosen name.");
        WriteJsonAtomically(MigrationPending, new PendingMove(old, backup, target));
        try
        {
            Directory.Move(old, backup);
            CreateJunction(old, target);
            if (!JunctionPointsTo(old, target))
                throw new IOException("Windows did not create a junction pointing to the expected AppData folder.");
            var record = new MigrationRecord(old, backup, target, DateTimeOffset.UtcNow.ToString("O"));
            WriteJsonAtomically(MigrationMarker, record);
            File.Delete(MigrationPending);
            return record;
        }
        catch
        {
            if (JunctionPointsTo(old, target)) Directory.Delete(old);
            if (!Directory.Exists(old) && Directory.Exists(backup)) Directory.Move(backup, old);
            if (Directory.Exists(old) && !IsReparse(old)) File.Delete(MigrationPending);
            throw;
        }
    }

    public void RollbackMigration()
    {
        PrepareRoot();
        RecoverInterruptedMigration();
        if (!IsMigrationCompleted) throw new InvalidOperationException("There is no completed migration to undo.");
        var record = ReadJson<MigrationRecord>(MigrationMarker)!;
        if (!SamePath(record.TargetPath, ExtensionDirectory) ||
            !JunctionPointsTo(record.OriginalPath, ExtensionDirectory) ||
            !Directory.Exists(record.BackupPath) || IsReparse(record.BackupPath) ||
            ReadManifestVersion(record.BackupPath) is null)
            throw new InvalidOperationException("The migration bridge or backup has changed. Nothing was removed.");
        RequireBrowsersClosed();
        Directory.Delete(record.OriginalPath); // Delete the junction itself, never its target.
        try
        {
            Directory.Move(record.BackupPath, record.OriginalPath);
            File.Delete(MigrationMarker);
        }
        catch
        {
            if (!Directory.Exists(record.OriginalPath)) CreateJunction(record.OriginalPath, ExtensionDirectory);
            throw;
        }
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
        if (!SamePath(state.TargetPath, ExtensionDirectory) || !Directory.Exists(state.BackupPath) ||
            IsReparse(state.BackupPath) || ReadManifestVersion(state.BackupPath) is null)
        {
            if (Directory.Exists(state.OriginalPath) && !IsReparse(state.OriginalPath) &&
                !Directory.Exists(state.BackupPath)) { File.Delete(MigrationPending); return; }
            throw new InvalidDataException("Migration recovery cannot verify the source backup. Nothing was deleted.");
        }
        RequireBrowsersClosed();
        if (JunctionPointsTo(state.OriginalPath, ExtensionDirectory))
        {
            WriteJsonAtomically(MigrationMarker,
                new MigrationRecord(state.OriginalPath, state.BackupPath, ExtensionDirectory, DateTimeOffset.UtcNow.ToString("O")));
            File.Delete(MigrationPending);
        }
        else if (!Directory.Exists(state.OriginalPath))
        {
            Directory.Move(state.BackupPath, state.OriginalPath);
            File.Delete(MigrationPending);
        }
        else throw new InvalidDataException("The old KoBa directory changed during migration; inspect it before proceeding.");
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
            throw new InvalidDataException("KoBa ZIP does not contain exactly ten reviewed runtime files.");
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

    private static bool JunctionPointsTo(string path, string target)
    {
        if (!IsReparse(path)) return false;
        try
        {
            var resolved = new DirectoryInfo(path).ResolveLinkTarget(returnFinalTarget: true);
            return resolved is not null && SamePath(resolved.FullName, target);
        }
        catch { return false; }
    }

    private static void CreateJunction(string link, string target)
    {
        if (Directory.Exists(link) || File.Exists(link))
            throw new InvalidOperationException("The old KoBa directory is already occupied; cannot make a safe junction.");
        var arguments = "/d /c mklink /J \"" + link + "\" \"" + target + "\"";
        var process = Process.Start(new ProcessStartInfo("cmd.exe", arguments)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true
        }) ?? throw new IOException("Unable to start Windows directory junction creation.");
        if (!process.WaitForExit(10000))
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw new IOException("Timed out creating the KoBa directory junction.");
        }
        if (process.ExitCode != 0) throw new IOException("Windows could not create the one-time KoBa junction.");
    }

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
