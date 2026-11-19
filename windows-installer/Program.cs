using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MoonDog.WindowsSetup;

internal static class Program
{
    private const string StableVersion = "0.10.17";
    // Published v0.10.17 clean-install ZIP release asset SHA-256; NOT updater JSON.
    private const string StableZipSha256 = "7360a65d29e61947f613f066e5cfa50b641d3fdc676fa2a774012eea34a68dce";
    private static readonly Guid DesktopKnownFolderId = new("B4BFCC3A-DB2C-424C-B029-7FE99A87C641");

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            string desktop = ResolveDesktop();
            if (MessageBox.Show(
                    "Create a brand-new MoonDog installation on this Windows Desktop?\n\n" +
                    "MoonDog creates its own folder, keeps existing folders untouched, " +
                    "and will not import or replace dealership data.\n\n" +
                    "Desktop: " + desktop,
                    "Install MoonDog", MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;

            using Stream? resource = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("MoonDog.OfficialStableZip");
            if (resource is null)
                throw new InvalidOperationException("This setup does not include an approved Stable package.");
            using var memory = new MemoryStream();
            resource.CopyTo(memory);
            // All package validation precedes creation of the destination.
            string installed = VerifiedInstaller.Install(
                memory.ToArray(), desktop, StableZipSha256, StableVersion,
                VerifiedInstaller.TryCreateNewWindowsDirectory);
            string launcher = Path.Combine(installed, "00 - OPEN DASHBOARD.html");
            if (TryStartEdge(launcher))
                MessageBox.Show("MoonDog is installed and its files are verified.\n\n" +
                    "Complete Guided Setup in Microsoft Edge with the correct store identity " +
                    "and a validated SAPR report for that same store.",
                    "Installation verified", MessageBoxButtons.OK, MessageBoxIcon.Information);
            else
                MessageBox.Show("MoonDog is installed and its files are verified.\n\n" +
                    "Open this file with Microsoft Edge to finish Guided Setup:\n" + launcher,
                    "Installation verified — open in Edge", MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            // No store/customer filenames, report contents, or exception dumps in UI/logs.
            MessageBox.Show("MoonDog installation was stopped safely.\n\n" +
                error.Message + "\n\nIf a new incomplete folder was created, leave it " +
                "untouched and do not use it as a working dealership installation.",
                "Installation not completed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static bool TryStartEdge(string launcher)
    {
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft", "Edge", "Application", "msedge.exe")
        };
        foreach (string edge in candidates)
        {
            if (!File.Exists(edge)) continue;
            try
            {
                var process = new ProcessStartInfo(edge) { UseShellExecute = false };
                process.ArgumentList.Add(launcher);
                Process.Start(process);
                return true;
            }
            catch { /* Missing browser launch is not an installation failure. */ }
        }
        return false;
    }

    private static string ResolveDesktop()
    {
        int result = SHGetKnownFolderPath(DesktopKnownFolderId, 0, IntPtr.Zero, out IntPtr pointer);
        if (result != 0 || pointer == IntPtr.Zero)
            throw new InvalidOperationException("Windows could not resolve this user's Desktop folder.");
        try
        {
            string? desktop = Marshal.PtrToStringUni(pointer);
            if (string.IsNullOrWhiteSpace(desktop) || !Path.IsPathFullyQualified(desktop) ||
                !Directory.Exists(desktop))
                throw new InvalidOperationException("Windows returned an unavailable Desktop folder.");
            return Path.GetFullPath(desktop);
        }
        finally { Marshal.FreeCoTaskMem(pointer); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHGetKnownFolderPath(
        [MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags,
        IntPtr hToken, out IntPtr ppszPath);
}
