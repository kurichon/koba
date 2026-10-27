using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace KoBa.Setup;

// No live user profile, JPDB key or browser API is touched by these installer tests.
internal static class SetupSelfTest
{
    internal static int Run(string[] args)
    {
        if (!OperatingSystem.IsWindows() || args.Length < 2 || !File.Exists(args[1]))
        {
            Console.Error.WriteLine("Usage: KoBaSetup.exe --self-test path-to-reviewed-KoBa_vVERSION.zip");
            return 2;
        }
        var root = Path.Combine(Path.GetTempPath(), "koba-installer-smoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var archive = args[1];
            var sha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(archive))).ToLowerInvariant();
            var version = Path.GetFileName(archive).Replace("KoBa_v", "").Replace(".zip", "");
            var engine = new InstallerEngine(Path.Combine(root, "AppData", "KoBa"));
            var installed = engine.InstallVerifiedPackage(archive, version, sha, requireClosedBrowsers: false);
            Equal(version, installed, "first installation");
            Equal(version, engine.GetInstalledVersion(), "installed manifest");
            var initialHash = sha;
            Equal(version, engine.InstallVerifiedPackage(archive, version, sha, false), "idempotent install");

            var wrong = new string('0', 64);
            Throws<InvalidDataException>(() => engine.InstallVerifiedPackage(archive, version, wrong, false),
                "bad checksum rejected");
            Equal(version, engine.GetInstalledVersion(), "checksum failure leaves installed files intact");

            var source = Path.Combine(root, "Original", "OldKoBa");
            Directory.CreateDirectory(Path.GetDirectoryName(source)!);
            CopyFolder(engine.ExtensionDirectory, source);
            var userFile = Path.Combine(source, "user-preserved-example.txt");
            File.WriteAllText(userFile, "do not discard existing folder extras");
            if (InstallerEngine.BrowserRunning())
                throw new InvalidOperationException("Close test browser processes before the one-time Windows migration smoke test.");
            var migration = engine.MigrateOnce(source);
            Check(Directory.Exists(migration.BackupPath), "migration must retain its original backup");
            Check(Directory.Exists(source), "original location becomes an existing junction");
            Check((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0, "old directory must be a junction");
            Equal(version, engine.GetInstalledVersion(), "migrated AppData version");
            Check(File.Exists(Path.Combine(migration.BackupPath, "user-preserved-example.txt")),
                  "extra files are retained only in the original backup");
            Throws<InvalidOperationException>(() => engine.MigrateOnce(source),
                "a completed one-time migration cannot repeat");

            // Simulate a different future release while keeping the installer itself unchanged.
            var next = "0.999.1";
            var future = Path.Combine(root, "KoBa_v" + next + ".zip");
            using (var input = ZipFile.OpenRead(archive))
            using (var output = ZipFile.Open(future, ZipArchiveMode.Create))
            {
                foreach (var entry in input.Entries)
                {
                    var created = output.CreateEntry(entry.FullName, CompressionLevel.Optimal);
                    using var stream = created.Open();
                    if (entry.FullName == "manifest.json")
                    {
                        var json = File.ReadAllText(Path.Combine(engine.ExtensionDirectory, "manifest.json"));
                        var updated = json.Replace("\"version\": \"" + version + "\"", "\"version\": \"" + next + "\"");
                        using var writer = new StreamWriter(stream);
                        writer.Write(updated);
                    }
                    else
                    {
                        using var original = entry.Open();
                        original.CopyTo(stream);
                    }
                }
            }
            var nextSha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(future))).ToLowerInvariant();
            Equal(next, engine.InstallVerifiedPackage(future, next, nextSha, false), "future version updates without migration");
            Equal(next, engine.GetInstalledVersion(), "new version installed");
            Check(File.Exists(Path.Combine(source, "manifest.json")), "old junction still resolves after an AppData directory swap");
            Check(Directory.GetDirectories(Path.Combine(engine.RootDirectory, "Backups")).Length == 1,
                  "prior version retained for update rollback");
            Equal(next, engine.InstallVerifiedPackage(archive, version, initialHash, false), "downgrade is ignored");
            engine.RollbackMigration();
            Check((File.GetAttributes(source) & FileAttributes.ReparsePoint) == 0, "rollback restores real old directory");
            Check(File.Exists(userFile), "rollback restores original extra files");
            Check(!engine.IsMigrationCompleted, "rollback resets the one-time marker");
            Equal(next, engine.GetInstalledVersion(), "rollback does not alter AppData's installed version");

            // A malformed ZIP must not touch an existing healthy installation.
            var malformed = Path.Combine(root, "KoBa_v0.999.2.zip");
            using (var output = ZipFile.Open(malformed, ZipArchiveMode.Create))
            {
                output.CreateEntry("../manifest.json");
                foreach (var file in new[] { "LICENSE", "background.js", "content.js", "lib.js", "options.html",
                                            "options.js", "panel.js", "session.js", "updates.js" })
                    output.CreateEntry(file);
            }
            var malformedSha = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(malformed))).ToLowerInvariant();
            Throws<InvalidDataException>(() => engine.InstallVerifiedPackage(malformed, "0.999.2", malformedSha, false),
                "ZIP traversal blocked");
            Equal(next, engine.GetInstalledVersion(), "malformed ZIP cannot change current install");

            Console.WriteLine("PASS KoBa Windows installer: install, repeat, integrity, migration, no-repeat, " +
                              "future update, path bridge, backup, rollback, downgrade, malicious ZIP.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL KoBa installer self-test: " + ex);
            return 1;
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    private static void CopyFolder(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)));
    }

    private static void Check(bool condition, string label)
    {
        if (!condition) throw new Exception("Self-test failed: " + label);
    }

    private static void Equal(string expected, string? actual, string label) =>
        Check(expected == actual, label + " expected " + expected + ", got " + actual);

    private static void Throws<T>(Action action, string label) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new Exception("Expected " + typeof(T).Name + ": " + label);
    }
}
