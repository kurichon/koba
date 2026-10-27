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
        migrate.Text = "Prepare one-time transfer…";
        migrate.Width = 175; migrate.Height = 34;
        rollback.Text = "Restore original folder…";
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
                "Prepare your existing KoBa extension for a ONE-TIME browser-data transfer:\n\n" +
                "1. Resolve any pending JPDB review; close ALL Chrome and Brave windows.\n" +
                "2. Back up your ORIGINAL KoBa directory.\n" +
                "3. Put current KoBa files into the SAME original directory path (no junctions).\n" +
                "4. Reopen your OLD extension, export data from KoBa Options.\n" +
                "5. Load KoBa from AppData as a NEW extension and import that file.\n" +
                "6. Verify settings/JPDB before removing the old extension.\n\n" +
                "The export file contains the JPDB API key. Keep it private and delete it after verification. Continue?",
                "One-time KoBa migration", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer != DialogResult.Yes) return;
            await Execute(async () =>
            {
                var version = await engine.InstallLatestAsync();
                Append("Installed current KoBa " + version + " to AppData.");
                var result = engine.PrepareMigrationOnce(dialog.SelectedPath);
                Append("Original browser path prepared: " + result.OriginalPath);
                Append("Original folder backup: " + result.BackupPath);
                Append("OPEN OLD KoBa Options and export migration JSON before loading KoBa from AppData.");
                Append("Load AppData KoBa as a new unpacked extension. IMPORT the JSON and verify your JPDB data.");
                Append("Do not remove the old browser entry or original backup until your data is verified.");
                engine.SaveUpdaterCopy();
            });
        };
        rollback.Click += async (_, _) => await Execute(() =>
        {
            engine.RollbackMigrationPreparation();
            Append("Old browser extension files restored. The prepared folder copy was retained separately.");
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
                "\n\nMigration: first export your old extension data from KoBa Options at its original path; then " +
                "Load unpacked from AppData as a new browser extension and import that JSON there. " +
                "Only after verification retire the old browser entry. Future updates operate in AppData alone.",
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
        migrate.Enabled = !engine.IsMigrationPrepared;
        rollback.Enabled = engine.IsMigrationPrepared;
    }

    private void Append(string message)
    {
        output.AppendText(Environment.NewLine + Environment.NewLine + message);
    }
}
