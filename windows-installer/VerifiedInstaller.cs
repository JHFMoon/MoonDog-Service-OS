using System.ComponentModel;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MoonDog.WindowsSetup;

/// <summary>Clean, never-in-place, verified installation of an official Stable ZIP.
/// No existing store, installation root, report, or Workspace may be read or changed.</summary>
internal static class VerifiedInstaller
{
    private const string PackagePrefix = "Service Operations Dashboard/";
    private const string Marker = "MOONDOG-INSTALL-INCOMPLETE.txt";
    private const int MaxEntries = 350;
    private const long MaxArchiveBytes = 256L * 1024 * 1024;
    private const long MaxFileBytes = 64L * 1024 * 1024;
    private const long MaxUnpackedBytes = 192L * 1024 * 1024;
    private static readonly string[] RequiredDirectories = {
        "System Files/Workspace/", "System Files/Workspace/data/",
        "System Files/Workspace/data/history/", "System Files/Workspace/backups/",
        "System Files/Workspace/imports/", "System Files/Workspace/exports/",
        "System Files/Workspace/support/",
        "System Files/Workspace/01 - DROP REPORTS HERE/"
    };

    internal sealed record ApprovedFile(string Name, byte[] Bytes, string Hash);
    private sealed record ApprovedPackage(
        IReadOnlyDictionary<string, ApprovedFile> Files,
        IReadOnlySet<string> Directories, byte[] InventoryBytes);

    /// <summary>Native Win32 exclusive-create; unlike Directory.CreateDirectory,
    /// never adopts an existing folder. Error 183 = already exists.</summary>
    internal static bool TryCreateNewWindowsDirectory(string path)
    {
        if (CreateDirectoryW(path, IntPtr.Zero)) return true;
        int code = Marshal.GetLastWin32Error();
        if (code == 183) return false;
        throw new Win32Exception(code, "Windows could not create the new installation folder.");
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectoryW(string lpPathName, IntPtr lpSecurityAttributes);

    /// <summary>Inject an exclusive-create operation for isolated cross-platform tests;
    /// production always supplies TryCreateNewWindowsDirectory.</summary>
    internal static string Install(byte[] zipBytes, string desktopPath, string expectedZipSha256,
        string expectedVersion, Func<string, bool> exclusivelyCreateFolder,
        Action<string, string>? afterFileWritten = null)
    {
        if (zipBytes is null || zipBytes.Length < 22 || zipBytes.LongLength > MaxArchiveBytes)
            throw new InvalidDataException("The Stable installation package is incomplete or too large.");
        if (!IsSha256(expectedZipSha256) || !string.Equals(
                Convert.ToHexString(SHA256.HashData(zipBytes)), expectedZipSha256,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The Stable installation package failed official SHA-256 verification.");
        if (string.IsNullOrWhiteSpace(desktopPath) || !Path.IsPathFullyQualified(desktopPath) ||
            !Directory.Exists(desktopPath))
            throw new InvalidOperationException("The Windows Desktop folder is unavailable.");
        if (exclusivelyCreateFolder is null) throw new ArgumentNullException(nameof(exclusivelyCreateFolder));

        // Validation and hashing finish BEFORE any directory or file is created.
        ApprovedPackage package = ValidateZip(zipBytes, expectedVersion);
        string? destination = null;
        for (int number = 1; number <= 100; number++)
        {
            string name = number == 1 ? "Service Operations Dashboard" :
                $"Service Operations Dashboard ({number})";
            string candidate = Path.Combine(Path.GetFullPath(desktopPath), name);
            if (exclusivelyCreateFolder(candidate)) { destination = candidate; break; }
        }
        if (destination is null)
            throw new IOException("All available MoonDog installation folder names already exist.");

        // Failure leaves a visible incomplete marker, not a falsely valid install.
        WriteNewFile(destination, Marker, Encoding.UTF8.GetBytes(
            "MoonDog installation incomplete. Preserve this folder for inspection.\n"));
        foreach (string directory in package.Directories.OrderBy(d => d.Count(c => c == '/')))
            SafeCreateChildDirectory(destination, directory);

        foreach (ApprovedFile file in package.Files.Values)
        {
            WriteNewFile(destination, file.Name, file.Bytes);
            VerifyReadback(destination, file);
            afterFileWritten?.Invoke(destination, file.Name); // tests only; null in production
        }
        CheckFinalTree(destination, package);
        // Commit inventory *last*. Interrupted/corrupt copies have no valid inventory.
        WriteNewFile(destination, "INSTALLATION-MANIFEST.json", package.InventoryBytes);
        VerifyReadback(destination, new ApprovedFile("INSTALLATION-MANIFEST.json",
            package.InventoryBytes, Hash(package.InventoryBytes)));
        File.Delete(Path.Combine(destination, Marker));
        if (File.Exists(Path.Combine(destination, Marker)))
            throw new IOException("The incomplete-installation marker could not be removed.");
        return destination;
    }

    private static ApprovedPackage ValidateZip(byte[] zipBytes, string expectedVersion)
    {
        using var archive = new ZipArchive(new MemoryStream(zipBytes, writable:false),
            ZipArchiveMode.Read, leaveOpen:false, entryNameEncoding:Encoding.UTF8);
        if (archive.Entries.Count < 4 || archive.Entries.Count > MaxEntries)
            throw new InvalidDataException("The ZIP contains an unsupported number of entries.");
        var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        var explicitDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long totalSize = 0;
        foreach (ZipArchiveEntry entry in archive.Entries)
        {
            string path = entry.FullName;
            if (!path.StartsWith(PackagePrefix, StringComparison.Ordinal) ||
                path.Contains('\\') || HasLinkAttribute(entry))
                throw new InvalidDataException("The ZIP contains an unexpected or unsafe installation path.");
            string relative = path[PackagePrefix.Length..];
            bool isDirectory = path.EndsWith('/');
            if (relative.Length == 0 && isDirectory) continue;
            if (!SafeRelativePath(relative, isDirectory))
                throw new InvalidDataException("The ZIP contains an unsafe Windows path.");
            if (isDirectory)
            {
                if (!explicitDirectories.Add(relative))
                    throw new InvalidDataException("The ZIP contains duplicate folder paths.");
                if (entry.Length != 0 || !RequiredDirectories.Contains(relative, StringComparer.Ordinal))
                    throw new InvalidDataException("The ZIP contains an unexpected directory.");
                continue;
            }
            if (entry.Length > MaxFileBytes || entry.Length < 0)
                throw new InvalidDataException("The ZIP contains an oversized file.");
            totalSize = checked(totalSize + entry.Length);
            if (totalSize > MaxUnpackedBytes)
                throw new InvalidDataException("The ZIP exceeds the approved unpacked size.");
            if (files.ContainsKey(relative) || explicitDirectories.Contains(relative + "/"))
                throw new InvalidDataException("The ZIP contains duplicate file paths.");
            using var stream = entry.Open();
            using var output = new MemoryStream();
            var chunk = new byte[64 * 1024];
            int read;
            while ((read = stream.Read(chunk, 0, chunk.Length)) != 0)
            {
                if (output.Length + read > entry.Length || output.Length + read > MaxFileBytes)
                    throw new InvalidDataException("A ZIP member exceeds its declared size.");
                output.Write(chunk, 0, read);
            }
            if (output.Length != entry.Length)
                throw new InvalidDataException("The ZIP member could not be verified.");
            files[relative] = output.ToArray();
        }
        if (!RequiredDirectories.All(d => explicitDirectories.Contains(d)))
            throw new InvalidDataException("The package is missing required private Workspace folders.");
        if (!files.TryGetValue("INSTALLATION-MANIFEST.json", out byte[]? manifestBytes) ||
            manifestBytes.Length > 2 * 1024 * 1024)
            throw new InvalidDataException("The approved package inventory is missing.");
        using var json = JsonDocument.Parse(manifestBytes);
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            Str(root, "format") != "service-operations-dashboard-clean-install" ||
            root.GetProperty("formatVersion").GetInt32() != 1 ||
            Str(root, "version") != expectedVersion ||
            Str(root, "packageRoot") != "Service Operations Dashboard" ||
            Str(root, "launcher") != "00 - OPEN DASHBOARD.html" ||
            Str(root, "applicationRoot") != "System Files" ||
            Str(root, "workspaceRoot") != "System Files/Workspace" ||
            Str(root, "updateChannel") != "stable" ||
            !root.GetProperty("workspaceProtectedFromUpdates").GetBoolean())
            throw new InvalidDataException("The package inventory does not match the verified Stable layout.");
        var approved = new Dictionary<string, ApprovedFile>(StringComparer.OrdinalIgnoreCase);
        foreach (JsonElement item in root.GetProperty("files").EnumerateArray())
        {
            string name = Str(item, "path");
            string digest = Str(item, "sha256");
            long size = item.GetProperty("size").GetInt64();
            if (!SafeRelativePath(name, false) || !IsSha256(digest) || size < 0 || size > MaxFileBytes ||
                !files.TryGetValue(name, out byte[]? payload) || size != payload.LongLength ||
                !string.Equals(Hash(payload), digest, StringComparison.OrdinalIgnoreCase) ||
                !approved.TryAdd(name, new ApprovedFile(name, payload, digest)))
                throw new InvalidDataException("The package inventory contains an unapproved application file.");
            if (name.StartsWith("System Files/Workspace/", StringComparison.OrdinalIgnoreCase) &&
                name != "System Files/Workspace/README.txt")
                throw new InvalidDataException("A clean installation cannot contain dealership Workspace data.");
        }
        foreach (string required in new[] { "00 - OPEN DASHBOARD.html",
                     "System Files/index.html", "System Files/Workspace/README.txt" })
            if (!approved.ContainsKey(required))
                throw new InvalidDataException("The package is missing its launcher or private-data boundary.");
        if (approved.Count + 1 != files.Count)
            throw new InvalidDataException("The package ZIP contains files outside its approved inventory.");

        var directories = new HashSet<string>(RequiredDirectories, StringComparer.OrdinalIgnoreCase);
        foreach (string file in approved.Keys.Append("INSTALLATION-MANIFEST.json"))
        {
            string[] parts = file.Split('/');
            for (int length = 1; length < parts.Length; length++)
                directories.Add(string.Join('/', parts.Take(length)) + "/");
        }
        return new ApprovedPackage(approved, directories, manifestBytes);
    }

    private static string Str(JsonElement element, string property) =>
        element.GetProperty(property).GetString() ?? string.Empty;
    private static bool IsSha256(string? value) => value is { Length:64 } &&
        value.All(c => (c is >= '0' and <= '9') || (c is >= 'a' and <= 'f'));
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool HasLinkAttribute(ZipArchiveEntry entry) =>
        ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000;

    private static bool SafeRelativePath(string relative, bool directory)
    {
        if (string.IsNullOrEmpty(relative) || relative.Contains('\\') || relative.Contains(':') ||
            relative.StartsWith('/') || (!directory && relative.EndsWith('/')) ||
            (directory && !relative.EndsWith('/'))) return false;
        string[] parts = (directory ? relative[..^1] : relative).Split('/');
        foreach (string segment in parts)
        {
            if (segment.Length == 0 || segment is "." or ".." ||
                segment.EndsWith('.') || segment.EndsWith(' ') ||
                segment.Any(c => char.IsControl(c) || "<>:\"|?*".Contains(c))) return false;
            string stem = segment.Split('.')[0].ToUpperInvariant();
            if (stem is "CON" or "PRN" or "AUX" or "NUL" ||
                (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) &&
                 stem[3] >= '1' && stem[3] <= '9')) return false;
        }
        return true;
    }

    private static string SafeDestination(string root, string relative)
    {
        if (!SafeRelativePath(relative, false))
            throw new InvalidDataException("Unsafe relative installation path.");
        string target = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The installation path escapes its new folder.");
        return target;
    }

    private static void SafeCreateChildDirectory(string root, string relativeDirectory)
    {
        string path = SafeDestination(root, relativeDirectory.TrimEnd('/'));
        if (File.Exists(path)) throw new IOException("An unapproved file blocks installation.");
        if (Directory.Exists(path) &&
            (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("A linked folder appeared during installation; refusing to follow it.");
        Directory.CreateDirectory(path);
    }

    private static void WriteNewFile(string root, string relative, byte[] bytes)
    {
        string path = SafeDestination(root, relative);
        string? folder = Path.GetDirectoryName(path);
        if (folder == null || !Directory.Exists(folder))
            throw new IOException("An approved application directory is missing.");
        // Never follow reparse folders inserted by another process/OneDrive between checks.
        string prefix = Path.GetFullPath(root);
        string remainder = Path.GetRelativePath(prefix, folder);
        foreach (string step in remainder.Split(Path.DirectorySeparatorChar))
        {
            if (step is "." or "") continue;
            prefix = Path.Combine(prefix, step);
            if ((File.GetAttributes(prefix) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("A linked directory was detected during installation.");
        }
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        stream.Write(bytes);
        stream.Flush(flushToDisk:true);
    }

    private static void VerifyReadback(string root, ApprovedFile file)
    {
        string path = SafeDestination(root, file.Name);
        byte[] bytes = File.ReadAllBytes(path);
        if (bytes.LongLength != file.Bytes.LongLength ||
            !CryptographicOperations.FixedTimeEquals(bytes, file.Bytes) ||
            !string.Equals(Hash(bytes), file.Hash, StringComparison.OrdinalIgnoreCase))
            throw new IOException("An installed application file failed durable readback.");
    }

    private static void CheckFinalTree(string root, ApprovedPackage approved)
    {
        var requiredFiles = new HashSet<string>(approved.Files.Keys, StringComparer.OrdinalIgnoreCase);
        requiredFiles.Add(Marker);
        var foundFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var foundDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var stack = new Stack<string>();
        stack.Push(root);
        // Walk one level at a time; do not recursively enumerate through a
        // symlink/reparse directory that may have appeared during an install.
        while (stack.Count > 0)
        {
            string parent = stack.Pop();
            foreach (string path in Directory.EnumerateFileSystemEntries(parent))
            {
                FileAttributes attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("An unknown linked entry appeared during installation.");
                string relative = Path.GetRelativePath(root, path).Replace('\\', '/');
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    string directory = relative + "/";
                    if (!approved.Directories.Contains(directory) || !foundDirs.Add(directory))
                        throw new IOException("An unknown directory appeared during installation.");
                    stack.Push(path);
                }
                else
                {
                    if (!requiredFiles.Contains(relative) || !foundFiles.Add(relative))
                        throw new IOException("An unknown file appeared during installation.");
                    if (relative != Marker)
                        VerifyReadback(root, approved.Files[relative]);
                }
            }
        }
        if (foundFiles.Count != requiredFiles.Count)
            throw new IOException("An installation file disappeared before completion.");
        if (foundDirs.Count != approved.Directories.Count)
            throw new IOException("An application directory disappeared before completion.");
    }
}
