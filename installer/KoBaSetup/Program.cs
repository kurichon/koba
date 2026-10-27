using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace KoBa.Setup;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
            return SetupSelfTest.Run(args);
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupForm());
        return 0;
    }
}

internal sealed class SetupForm : Form
{
    private readonly InstallerEngine engine = new();
    private readonly Label location = new();
    private readonly TextBox output = new();
    private readonly Button install = new();
    private readonly Button migrate = new();
    private readonly Button rollback = new();
    private readonly Button browse = new();
    private readonly Button instructions = new();

    public SetupForm()
    {
        Text = "KoBa — Setup & Updates";
        Size = new Size(710, 490);
        MinimumSize = new Size(630, 450);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        var title = new Label
        {
            Text = "KoBa  ·  Kotoba no Soba",
            Font = new Font(Font.FontFamily, 19, FontStyle.Bold),
            AutoSize = false, Dock = DockStyle.Top, Height = 52,
            Padding = new Padding(18, 12, 0, 0)
        };
        var lead = new Label
        {
            Text = "Install once to a fixed location. Future updates replace only the extension files.",
            Dock = DockStyle.Top, Height = 40, Padding = new Padding(20, 4, 0, 4)
        };
        location.Dock = DockStyle.Top;
        location.Height = 64;
        location.Padding = new Padding(20, 8, 12, 5);
        location.AutoEllipsis = true;

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 95, Padding = new Padding(14, 6, 12, 6),
            WrapContents = true, AutoScroll = true
        };
        install.Text = "Install / Update KoBa";
        install.Width = 165; install.Height = 34;
        migrate.Text = "Migrate old installation…";
        migrate.Width = 175; migrate.Height = 34;
        rollback.Text = "Undo migration…";
        rollback.Width = 145; rollback.Height = 34;
        browse.Text = "Open KoBa folder";
        browse.Width = 150; browse.Height = 32;
        instructions.Text = "Browser setup";
        instructions.Width = 130; instructions.Height = 32;
        actions.Controls.AddRange(new Control[] { install, migrate, rollback, browse, instructions });

        output.Multiline = true;
        output.ReadOnly = true;
        output.WordWrap = true;
        output.ScrollBars = ScrollBars.Vertical;
        output.Dock = DockStyle.Fill;
        output.Font = new Font("Consolas", 10);
        output.BackColor = SystemColors.Window;
        output.Text = "KoBa downloads verified files from github.com/kurichon/koba.\r\n" +
                      "Your JPDB credentials and browser profile are never read by the updater.\r\n" +
                      "The browser must be fully closed while existing extension files change.";

        Controls.Add(output);
        Controls.Add(actions);
        Controls.Add(location);
        Controls.Add(lead);
        Controls.Add(title);
        RefreshState();

        install.Click += async (_, _) => await Execute(async () =>
        {
            var version = await engine.InstallLatestAsync();
            Append("KoBa " + version + " installed at " + engine.ExtensionDirectory);
            Append("Start Chrome/Brave and reload KoBa in its Extensions page.");
            engine.SaveUpdaterCopy();
        });
        migrate.Click += async (_, _) =>
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "Choose the existing KoBa extension folder containing manifest.json",
                UseDescriptionForTitle = true,
                ShowNewFolderButton = false
            };
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            var answer = MessageBox.Show(this,
                "One-time migration of the selected existing KoBa directory:\n\n" +
                "• Close ALL Chrome and Brave windows first.\n" +
                "• A verified current release is installed in AppData.\n" +
                "• Your original folder is retained as a backup.\n" +
                "• A directory junction remains at the ORIGINAL browser path, " +
                "so its unpacked extension identity and local data can remain associated with it.\n\n" +
                "Do not remove your existing browser extension. Continue?",
                "One-time KoBa migration", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return;
            await Execute(async () =>
            {
                var version = await engine.InstallLatestAsync();
                Append("Installed current KoBa " + version + " to AppData.");
                var result = engine.MigrateOnce(dialog.SelectedPath);
                Append("Migration bridge: " + result.OriginalPath + " → " + engine.ExtensionDirectory);
                Append("Original folder backup: " + result.BackupPath);
                Append("Restart the browser and verify your JPDB settings. Do not uninstall the existing extension.");
                engine.SaveUpdaterCopy();
            });
        };
        rollback.Click += async (_, _) => await Execute(() =>
        {
            engine.RollbackMigration();
            Append("Migration undone. Your original KoBa directory was restored from its retained backup.");
            Append("The AppData installation remains intact; do not load another copy without checking extension identity.");
            return Task.CompletedTask;
        });
        browse.Click += (_, _) =>
        {
            if (Directory.Exists(engine.ExtensionDirectory))
                Process.Start(new ProcessStartInfo("explorer.exe", "\"" + engine.ExtensionDirectory + "\"") { UseShellExecute = true });
            else Append("KoBa is not yet installed under AppData.");
        };
        instructions.Click += (_, _) =>
            MessageBox.Show(this, "First install: Open chrome://extensions or brave://extensions, enable Developer mode, " +
                "select Load unpacked, then choose:\n\n" + engine.ExtensionDirectory +
                "\n\nExisting installation: After one-time migration, keep the existing browser entry and " +
                "reload it. New KoBa versions update files in AppData without another migration.",
                "Load / reload KoBa", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private async Task Execute(Func<Task> work)
    {
        install.Enabled = migrate.Enabled = rollback.Enabled = false;
        UseWaitCursor = true;
        try
        {
            await work();
        }
        catch (Exception ex)
        {
            Append("Action stopped safely: " + ex.Message);
            MessageBox.Show(this, ex.Message, "KoBa setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            UseWaitCursor = false;
            RefreshState();
        }
    }

    private void RefreshState()
    {
        var version = engine.GetInstalledVersion() ?? "not installed";
        location.Text = "Install directory: " + engine.ExtensionDirectory + Environment.NewLine +
                        "Installed extension version: " + version;
        install.Enabled = true;
        migrate.Enabled = !engine.IsMigrationCompleted;
        rollback.Enabled = engine.IsMigrationCompleted;
    }

    private void Append(string message)
    {
        output.AppendText(Environment.NewLine + Environment.NewLine + message);
    }
}
