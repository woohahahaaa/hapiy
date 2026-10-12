// MainForm.cs — woohkit 通用 Windows 外壳：一个只打开本机控制台的窗口。
//
// 用系统自带的 WebView2 运行时（Win10/11 随 Edge 预装）而不是打包浏览器：
// 进程属于自己，任务栏/Alt-Tab 里显示的就是本应用图标，窗口没有浏览器工具栏。
// 端口每次启动时从用户目录下的 <PortRelPath> 读取，读不到退回 DefaultPort；
// 后端没起来就每秒重试，最多 30 次。
//
// 本文件只写通用逻辑；应用名/端口/主题色来自构建时生成的 ShellConfig.cs
// （shell/winapp/build.sh），项目不要去改这里。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KitShell
{
    internal sealed class MainForm : Form
    {
        private const int MaxRetries = 30;

        // 与界面主题色一致（由构建时生成的 ShellConfig 决定）。
        private static readonly Color ThemeColor = Color.FromArgb(ShellConfig.ThemeR, ShellConfig.ThemeG, ShellConfig.ThemeB);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        private static void ApplyDarkTitlebar(Form form)
        {
            // DWMWA_USE_IMMERSIVE_DARK_MODE：20 是 Win10 2004+/Win11 的官方值，
            // 19 是 Win10 1903-2004 的旧值；不支持的系统两个都会失败，忽略即可。
            int on = 1;
            if (DwmSetWindowAttribute(form.Handle, 20, ref on, 4) != 0)
            {
                DwmSetWindowAttribute(form.Handle, 19, ref on, 4);
            }
        }

        private static int _openForms;

        private readonly WebView2 _view = new WebView2();
        private readonly Timer _retryTimer = new Timer();
        private readonly string _initialUrl;
        private int _retries;

        public MainForm(string initialUrl = null)
        {
            _initialUrl = initialUrl;

            Text = ShellConfig.AppName;
            ClientSize = new Size(1380, 880);
            MinimumSize = new Size(720, 480);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // 纯深色边框：窗体背景与 WebView2 底色都设为主题色，加载期间不闪白；
            // 标题栏走系统深色模式，需要窗口句柄，在 Shown 里再调一次。
            BackColor = ThemeColor;
            Shown += (s, e) => ApplyDarkTitlebar(this);

            _view.Dock = DockStyle.Fill;
            _view.DefaultBackgroundColor = ThemeColor;
            Controls.Add(_view);

            _retryTimer.Interval = 1000;
            _retryTimer.Tick += (s, e) => { _retryTimer.Stop(); Navigate(ConsoleUrl()); };

            Load += async (s, e) => await InitAsync();
            FormClosed += (s, e) => { if (--_openForms <= 0) Application.Exit(); };
            _openForms++;
        }

        private static string ConsoleUrl()
        {
            var port = ShellConfig.DefaultPort;
            try
            {
                var path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ShellConfig.PortRelPath);
                int parsed;
                if (int.TryParse(File.ReadAllText(path).Trim(), out parsed) && parsed > 0 && parsed < 65536)
                {
                    port = parsed;
                }
            }
            catch
            {
                // 没有 port 文件就退回默认端口
            }
            return "http://127.0.0.1:" + port + "/";
        }

        private static bool IsLocal(Uri uri)
        {
            return uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "::1";
        }

        private static void OpenInDefaultBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        private async Task InitAsync()
        {
            try
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    ShellConfig.AppName, "webview2");
                var environment = await CoreWebView2Environment.CreateAsync(null, userData, null);
                await _view.EnsureCoreWebView2Async(environment);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "WebView2 初始化失败：\n" + ex.Message +
                    "\n\n请确认已安装 Microsoft Edge WebView2 Runtime（Win10/11 一般随 Edge 自带）。",
                    ShellConfig.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            var core = _view.CoreWebView2;

            // window.open / target=_blank：本机页面开新窗口，外部链接交给默认浏览器。
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                Uri uri;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) return;
                if (IsLocal(uri)) new MainForm(uri.ToString()).Show();
                else OpenInDefaultBrowser(e.Uri);
            };

            // 顶层导航到外部地址：也交给默认浏览器，外壳只服务本机控制台。
            core.NavigationStarting += (s, e) =>
            {
                Uri uri;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) &&
                    (uri.Scheme == "http" || uri.Scheme == "https") && !IsLocal(uri))
                {
                    e.Cancel = true;
                    OpenInDefaultBrowser(e.Uri);
                }
            };

            // 后端可能还没起来：加载失败就 1 秒后重试。
            core.NavigationCompleted += (s, e) =>
            {
                if (e.IsSuccess) _retries = 0;
                else Retry();
            };

            Navigate(_initialUrl ?? ConsoleUrl());
        }

        private void Navigate(string url)
        {
            try { _view.Source = new Uri(url); } catch { }
        }

        private void Retry()
        {
            if (_retries >= MaxRetries) return;
            _retries++;
            _retryTimer.Start();
        }
    }
}
