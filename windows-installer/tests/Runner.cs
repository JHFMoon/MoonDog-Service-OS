using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MoonDog.WindowsSetup;

// Dependency-free tests of actual installer core; run on Windows and Linux with .NET 8.
// Windows Known Folder/Edge/Authenticode and OneDrive field proof remain separate.
internal static class Runner
{
    private static int passed;
    private static readonly string[] WorkspaceDirs = {
        "System Files/Workspace/", "System Files/Workspace/data/",
        "System Files/Workspace/data/history/", "System Files/Workspace/backups/",
        "System Files/Workspace/imports/", "System Files/Workspace/exports/",
        "System Files/Workspace/support/", "System Files/Workspace/01 - DROP REPORTS HERE/"
    };
    private static readonly byte[] Launcher = Encoding.UTF8.GetBytes("<h1>MoonDog synthetic launcher</h1>");
    private static readonly byte[] App = Encoding.UTF8.GetBytes("<h1>MoonDog synthetic application</h1>");
    private static readonly byte[] WorkspaceReadme = Encoding.UTF8.GetBytes("Synthetic clean, unconfigured Workspace. No dealership data.");

    private static void Main()
    {
        Check("new install creates its own folder, verifies launcher and leaves Workspace empty", () =>
        {
            WithTempDesktop(desktop => {
                var zip = BuildSyntheticZip();
                string installed = Install(zip, desktop);
                Equal(Path.GetFileName(installed), "Service Operations Dashboard");
                Equal(File.ReadAllBytes(Path.Combine(installed, "00 - OPEN DASHBOARD.html")), Launcher);
                True(File.Exists(Path.Combine(installed, "INSTALLATION-MANIFEST.json")));
                True(!File.Exists(Path.Combine(installed, "MOONDOG-INSTALL-INCOMPLETE.txt")));
                True(Directory.Exists(Path.Combine(installed, "System Files", "Workspace", "data")));
                True(!File.Exists(Path.Combine(installed, "System Files", "Workspace", "data", "settings.json")));
            });
        });
        Check("existing installation remains unchanged and a second new store is isolated", () =>
        {
            WithTempDesktop(desktop => {
                string existing = Path.Combine(desktop, "Service Operations Dashboard");
                Directory.CreateDirectory(existing);
                File.WriteAllText(Path.Combine(existing, "customer-original.txt"), "SYNTHETIC ORIGINAL");
                string result = Install(BuildSyntheticZip(), desktop);
                Equal(Path.GetFileName(result), "Service Operations Dashboard (2)");
                Equal(File.ReadAllText(Path.Combine(existing, "customer-original.txt")), "SYNTHETIC ORIGINAL");
                True(!File.Exists(Path.Combine(existing, "INSTALLATION-MANIFEST.json")));
                string other = Install(BuildSyntheticZip(), desktop);
                Equal(Path.GetFileName(other), "Service Operations Dashboard (3)");
                True(!result.Equals(other, StringComparison.OrdinalIgnoreCase));
            });
        });
        Check("wrong archive hash creates no installation", () =>
        {
            WithTempDesktop(desktop => {
                var zip = BuildSyntheticZip();
                Throws<InvalidDataException>(() => VerifiedInstaller.Install(zip, desktop,
                    new string('f', 64), "0.10.17", CreateSyntheticNew));
                True(!Directory.EnumerateFileSystemEntries(desktop).Any());
            });
        });
        Check("corrupted inventory, wrong version and unsafe traversal fail before writes", () =>
        {
            WithTempDesktop(desktop => {
                var bad = BuildSyntheticZip(extraFile:"System Files/Workspace/data/settings.json");
                Throws<InvalidDataException>(() => Install(bad, desktop));
                var traversal = BuildSyntheticZip(extraFile:"../outside.txt");
                Throws<InvalidDataException>(() => Install(traversal, desktop));
                var valid = BuildSyntheticZip();
                Throws<InvalidDataException>(() => VerifiedInstaller.Install(valid, desktop,
                    Hash(valid), "0.10.16", CreateSyntheticNew));
                True(!Directory.EnumerateFileSystemEntries(desktop).Any());
            });
        });
        Check("foreign file during installation blocks manifest and preserves incomplete marker", () =>
        {
            WithTempDesktop(desktop => {
                string? destination = null;
                var zip = BuildSyntheticZip();
                Throws<IOException>(() => VerifiedInstaller.Install(zip, desktop,
                    Hash(zip), "0.10.17", CreateSyntheticNew,
                    (root, file) => {
                        destination = root;
                        if (file == "00 - OPEN DASHBOARD.html")
                            File.WriteAllText(Path.Combine(root, "foreign.txt"), "SYNTHETIC OTHER WRITER");
                    }));
                True(destination is not null);
                True(File.Exists(Path.Combine(destination!, "MOONDOG-INSTALL-INCOMPLETE.txt")));
                True(!File.Exists(Path.Combine(destination!, "INSTALLATION-MANIFEST.json")));
                Equal(File.ReadAllText(Path.Combine(destination!, "foreign.txt")), "SYNTHETIC OTHER WRITER");
            });
        });
        Check("tampered launcher blocks final inventory and keeps incomplete marker", () =>
        {
            WithTempDesktop(desktop => {
                string? destination = null;
                var zip = BuildSyntheticZip();
                Throws<IOException>(() => VerifiedInstaller.Install(zip, desktop, Hash(zip),
                    "0.10.17", CreateSyntheticNew, (root, file) => {
                        destination = root;
                        if (file == "00 - OPEN DASHBOARD.html")
                            File.WriteAllText(Path.Combine(root, "00 - OPEN DASHBOARD.html"), "TAMPERED");
                    }));
                True(File.Exists(Path.Combine(destination!, "MOONDOG-INSTALL-INCOMPLETE.txt")));
                True(!File.Exists(Path.Combine(destination!, "INSTALLATION-MANIFEST.json")));
            });
        });
        Console.WriteLine($"Windows installer core: {passed}/6 synthetic scenarios passed.");
    }

    private static string Install(byte[] zip, string desktop) => VerifiedInstaller.Install(
        zip, desktop, Hash(zip), "0.10.17", CreateSyntheticNew);

    // Simulation only: production never uses this operation, and instead relies on
    // native CreateDirectoryW's ERROR_ALREADY_EXISTS exclusion semantics.
    private static bool CreateSyntheticNew(string path)
    {
        if (Directory.Exists(path) || File.Exists(path)) return false;
        Directory.CreateDirectory(path);
        return true;
    }

    private static byte[] BuildSyntheticZip(string? extraFile = null)
    {
        var files = new Dictionary<string, byte[]> {
            ["00 - OPEN DASHBOARD.html"] = Launcher,
            ["System Files/index.html"] = App,
            ["System Files/Workspace/README.txt"] = WorkspaceReadme
        };
        var manifestFiles = files.Select(kv => new {
            path = kv.Key, size = kv.Value.LongLength, sha256 = Hash(kv.Value)
        }).ToArray();
        var manifest = new {
            format = "service-operations-dashboard-clean-install",
            formatVersion = 1,
            version = "0.10.17",
            packageRoot = "Service Operations Dashboard",
            launcher = "00 - OPEN DASHBOARD.html",
            applicationRoot = "System Files",
            workspaceRoot = "System Files/Workspace",
            updateChannel = "stable",
            workspaceProtectedFromUpdates = true,
            files = manifestFiles
        };
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen:true))
        {
            archive.CreateEntry("Service Operations Dashboard/");
            foreach (string name in WorkspaceDirs)
                archive.CreateEntry("Service Operations Dashboard/" + name);
            foreach (var (name, bytes) in files)
            {
                using var stream = archive.CreateEntry("Service Operations Dashboard/" + name).Open();
                stream.Write(bytes);
            }
            if (extraFile != null)
            {
                using var stream = archive.CreateEntry("Service Operations Dashboard/" + extraFile).Open();
                stream.Write(Encoding.UTF8.GetBytes("SYNTHETIC BLOCKED CONTENT"));
            }
            using var inventory = archive.CreateEntry("Service Operations Dashboard/INSTALLATION-MANIFEST.json").Open();
            inventory.Write(JsonSerializer.SerializeToUtf8Bytes(manifest));
        }
        return output.ToArray();
    }

    private static void WithTempDesktop(Action<string> action)
    {
        string desktop = Path.Combine(Path.GetTempPath(), "moondog-synthetic-installer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(desktop);
        try { action(desktop); }
        finally { Directory.Delete(desktop, recursive:true); }
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new Exception("Expected " + typeof(T).Name + " but operation succeeded or threw a different exception.");
    }
    private static void True(bool condition)
    {
        if (!condition) throw new Exception("Synthetic assertion failed.");
    }
    private static void Equal(byte[] actual, byte[] expected)
    {
        if (!actual.AsSpan().SequenceEqual(expected)) throw new Exception("Synthetic byte mismatch.");
    }
    private static void Equal(string actual, string expected)
    {
        if (actual != expected) throw new Exception("Synthetic value mismatch.");
    }
    private static void Check(string name, Action test)
    {
        try { test(); passed++; Console.WriteLine("PASS: " + name); }
        catch (Exception ex) { Console.Error.WriteLine("FAIL: " + name + " — " + ex.Message); throw; }
    }
}
