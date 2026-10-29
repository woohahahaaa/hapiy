// MainForm.cs — woohkit 通用 Windows 外壳：一个只打开本机控制台的窗口。
//
// 用系统自带的 WebView2 运行时（Win10/11 随 Edge 预装）而不是打包浏览器：
// 进程属于自己，任务栏/Alt-Tab 里显示的就是本应用图标，窗口没有浏览器工具栏。
// 端口每次启动时从用户目录下的 <PortRelPath> 读取，读不到退回 DefaultPort；
// 后端没起来就每秒重试，最多 30 次。
//
// 外观两个开关（ShellConfig.Glass / ShellConfig.Frameless，来自项目
// alive/woohkit.json 的 shell 块）：
//   - Frameless：自绘标题条——顶部 32px，右端三个窗口按钮（最小化/最大化/
//     关闭），其余区域按住即拖动窗口；窗口边缘 6px 可拉伸。窗口本体仍是标准
//     可调窗口（WM_NCCALCSIZE 把非客户区清掉），贴边分屏、双击最大化、圆角、
//     投影都是系统原生行为。false = 系统原生标题栏（深色）。
//   - Glass：Win11 22H2+（build ≥ 22621）用 DWM 系统背景材质（Acrylic）+ 扩展
//     边框，页面底色透明、DWM 材质透出来（标题条用“黑=透明”的老规矩清底）；
//     其它系统（Win10 等）自动退回主题色纯色，不会黑屏。页面用半透明背景
//     （rgba/transparent）就透出玻璃；不透明时玻璃只在标题条/露出处显形。
//
// 本文件只写通用逻辑；应用名/端口/主题色/外观来自构建时生成的 ShellConfig.cs
// （shell/winapp/build.sh），项目不要去改这里。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
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

        [StructLayout(LayoutKind.Sequential)]
        private struct MARGINS { public int left, top, right, bottom; }

        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left, top, right, bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct NCCALCSIZE_PARAMS
        {
            public RECT rgrc0, rgrc1, rgrc2;
            public IntPtr lppos;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor, rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);

        [DllImport("user32.dll")]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hwnd);

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

        private static int WindowsBuild()
        {
            try
            {
                using (var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                           @"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    int build;
                    if (key != null &&
                        int.TryParse(Convert.ToString(key.GetValue("CurrentBuildNumber")), out build))
                    {
                        return build;
                    }
                }
            }
            catch
            {
                // 读不到就当作老系统：不上毛玻璃
            }
            return 0;
        }

        private static int _openForms;

        private readonly WebView2 _view = new WebView2();
        private readonly Timer _retryTimer = new Timer();
        private readonly string _initialUrl;
        private int _retries;

        // 无边框模式的度量与状态（Glass 关掉时都为 0/空）。
        private readonly int _captionH;
        private readonly int _btnW;
        private readonly int _resizeB;
        private bool _backdropOk;
        private int _hotButton = -1;

        public MainForm(string initialUrl = null)
        {
            _initialUrl = initialUrl;

            if (ShellConfig.Frameless)
            {
                _captionH = (int)Math.Round(32.0 * DeviceDpi / 96.0);
                _btnW = (int)Math.Round(46.0 * DeviceDpi / 96.0);
                _resizeB = (int)Math.Round(6.0 * DeviceDpi / 96.0);
            }

            Text = ShellConfig.AppName;
            ClientSize = new Size(1380, 880);
            MinimumSize = new Size(720, 480);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // 主题色：没上玻璃（老系统 / glass=false）时是窗口底色；上了玻璃
            // 时只在没有系统材质的机器上显形（标题条底色），有材质时不刷背景。
            BackColor = ThemeColor;
            if (ShellConfig.Frameless)
            {
                // 保留“标准可调窗口”本体（原生拉伸/分屏/最大化/圆角投影），
                // 非客户区由 WM_NCCALCSIZE 画没（见 WndProc）。
                Padding = new Padding(0, _captionH, 0, 0);
                DoubleBuffered = true;
            }
            else
            {
                // 原生标题栏走系统深色模式，需要窗口句柄，在 Shown 里再调一次。
                Shown += (s, e) => ApplyDarkTitlebar(this);
            }

            _view.Dock = DockStyle.Fill;
            _view.DefaultBackgroundColor = ThemeColor;
            Controls.Add(_view);

            _retryTimer.Interval = 1000;
            _retryTimer.Tick += (s, e) => { _retryTimer.Stop(); Navigate(_currentUrl); };

            Load += async (s, e) => await InitAsync();
            FormClosed += (s, e) => { if (--_openForms <= 0) Application.Exit(); };
            _openForms++;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (!ShellConfig.Glass) return;

            // Win11 22H2+ 才有系统背景材质；不支持就退回主题色纯色。
            if (WindowsBuild() >= 22621)
            {
                int on = 1;
                DwmSetWindowAttribute(Handle, 20, ref on, 4);       // 深色模式
                int round = 2;
                DwmSetWindowAttribute(Handle, 33, ref round, 4);    // Win11 圆角
                int acrylic = 3;                                    // DWMWA_SYSTEMBACKDROP_TYPE
                if (DwmSetWindowAttribute(Handle, 38, ref acrylic, 4) == 0)
                {
                    var m = new MARGINS { left = -1, top = -1, right = -1, bottom = -1 };
                    DwmExtendFrameIntoClientArea(Handle, ref m);
                    _backdropOk = true;
                    // 窗体自己不再刷背景，DWM 的材质才透得出来；标题条每次
                    // OnPaint 用黑色清底（扩展边框区里黑=透明）。
                    SetStyle(ControlStyles.Opaque | ControlStyles.AllPaintingInWmPaint, true);
                    Invalidate();
                }
            }
        }

        private static Point LParamPoint(IntPtr lParam)
        {
            int v = lParam.ToInt32();
            return new Point(unchecked((short)(v & 0xFFFF)), unchecked((short)((v >> 16) & 0xFFFF)));
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_NCCALCSIZE = 0x0083, WM_NCHITTEST = 0x0084, WM_NCLBUTTONDBLCLK = 0x00A3;

            if (ShellConfig.Frameless)
            {
                if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
                {
                    // 客户区 = 整个窗口：系统标题栏与边框就“画没”了，窗口在系统
                    // 眼里仍是个标准可调窗口（分屏/最大化/圆角投影都还在）。
                    if (IsZoomed(Handle))
                    {
                        // 最大化时窗口比工作区大出边框厚度，客户区按工作区收一下，
                        // 否则底部/右侧会有几个像素被裁掉。
                        var p = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(m.LParam, typeof(NCCALCSIZE_PARAMS));
                        var monitor = MonitorFromWindow(Handle, 2);    // MONITOR_DEFAULTTONEAREST
                        var mi = new MONITORINFO();
                        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                        if (GetMonitorInfo(monitor, ref mi))
                        {
                            p.rgrc0 = mi.rcWork;
                            Marshal.StructureToPtr(p, m.LParam, false);
                        }
                    }
                    m.Result = IntPtr.Zero;
                    return;
                }
                if (m.Msg == WM_NCHITTEST)
                {
                    base.WndProc(ref m);
                    if (m.Result.ToInt32() == 1)    // HTCLIENT
                    {
                        m.Result = (IntPtr)RefineHitTest(PointToClient(LParamPoint(m.LParam)));
                    }
                    return;
                }
                if (m.Msg == WM_NCLBUTTONDBLCLK && m.WParam.ToInt32() == 2)    // HTCAPTION
                {
                    ToggleMaximize();
                    return;
                }
            }
            base.WndProc(ref m);
        }

        private int RefineHitTest(Point p)
        {
            const int HTCLIENT = 1, HTCAPTION = 2;
            const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
            const int HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;

            // 右端三个按钮：留给自绘按钮收鼠标
            if (p.Y < _captionH && p.X >= ClientSize.Width - 3 * _btnW) return HTCLIENT;

            if (WindowState == FormWindowState.Normal)
            {
                bool left = p.X < _resizeB, right = p.X >= ClientSize.Width - _resizeB;
                bool top = p.Y < _resizeB, bottom = p.Y >= ClientSize.Height - _resizeB;
                if (top && left) return HTTOPLEFT;
                if (top && right) return HTTOPRIGHT;
                if (bottom && left) return HTBOTTOMLEFT;
                if (bottom && right) return HTBOTTOMRIGHT;
                if (left) return HTLEFT;
                if (right) return HTRIGHT;
                if (top) return HTTOP;
                if (bottom) return HTBOTTOM;
            }
            if (p.Y < _captionH) return HTCAPTION;    // 标题条其余部分：拖窗口
            return HTCLIENT;
        }

        private int ButtonAt(Point p)
        {
            if (!ShellConfig.Frameless || p.Y < 0 || p.Y >= _captionH) return -1;
            int x0 = ClientSize.Width - 3 * _btnW;
            if (p.X < x0) return -1;
            return (p.X - x0) / _btnW;    // 0=最小化 1=最大化/还原 2=关闭
        }

        private void ToggleMaximize()
        {
            WindowState = WindowState == FormWindowState.Maximized
                ? FormWindowState.Normal
                : FormWindowState.Maximized;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (!ShellConfig.Frameless || _captionH == 0) return;

            var g = e.Graphics;
            if (_backdropOk)
            {
                // 扩展边框区里黑色 = 全透明：清掉上一次画的按钮，露出玻璃
                using (var b = new SolidBrush(Color.Black))
                {
                    g.FillRectangle(b, 0, 0, ClientSize.Width, _captionH);
                }
            }

            int x0 = ClientSize.Width - 3 * _btnW;
            for (int i = 0; i < 3; i++)
            {
                var r = new Rectangle(x0 + i * _btnW, 0, _btnW, _captionH);
                if (i == _hotButton)
                {
                    using (var b = new SolidBrush(i == 2 ? Color.FromArgb(196, 43, 28) : Color.FromArgb(64, 255, 255, 255)))
                    {
                        g.FillRectangle(b, r);
                    }
                }
                var fg = (i == 2 && _hotButton == 2) ? Color.White : Color.FromArgb(232, 232, 232);
                using (var pen = new Pen(fg, 1f))
                {
                    int cx = r.X + _btnW / 2, cy = r.Height / 2, s = 5;
                    if (i == 0)          // 最小化
                    {
                        g.DrawLine(pen, cx - s, cy, cx + s, cy);
                    }
                    else if (i == 1)     // 最大化 / 还原
                    {
                        if (WindowState == FormWindowState.Maximized)
                        {
                            g.DrawRectangle(pen, cx - s, cy - s + 3, 2 * s - 3, 2 * s - 3);
                            g.DrawRectangle(pen, cx - s + 3, cy - s, 2 * s - 3, 2 * s - 3);
                        }
                        else
                        {
                            g.DrawRectangle(pen, cx - s, cy - s, 2 * s, 2 * s);
                        }
                    }
                    else                 // 关闭
                    {
                        g.DrawLine(pen, cx - s, cy - s, cx + s, cy + s);
                        g.DrawLine(pen, cx - s, cy + s, cx + s, cy - s);
                    }
                }
            }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int h = ButtonAt(e.Location);
            if (h != _hotButton) { _hotButton = h; Invalidate(); }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (_hotButton != -1) { _hotButton = -1; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            switch (ButtonAt(e.Location))
            {
                case 0: WindowState = FormWindowState.Minimized; break;
                case 1: ToggleMaximize(); break;
                case 2: Close(); break;
            }
        }

        private static string LocalConsoleUrl()
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

        // 外壳打开的地址：shell.url 预设优先；开机探一次，不通退回本机服务。
        // （不来回切：WebView2 对 cert/网络错误的处理方式因版本而异，启动时定一次最稳。）
        private string _currentUrl;

        private void OpenUrl(string url)
        {
            _currentUrl = url;
            Navigate(url);
        }

        private async void ResolveStartupUrl()
        {
            if (string.IsNullOrEmpty(ShellConfig.AppUrl))
            {
                OpenUrl(LocalConsoleUrl());
                return;
            }
            if (ShellConfig.AppUrl.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                OpenUrl(ShellConfig.AppUrl);
                return;
            }
            try
            {
                using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(4) })
                {
                    await http.GetAsync(ShellConfig.AppUrl);
                }
                OpenUrl(ShellConfig.AppUrl);
            }
            catch
            {
                OpenUrl(LocalConsoleUrl());
            }
        }

        private static bool IsLocal(Uri uri)
        {
            return uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "::1";
        }

        // 外壳「内部」的地址：本机，或 shell.url 预设的那个站（含 file:// 单页）。
        // 内部的留在窗口里；外部的交给系统浏览器。
        private static bool IsInternal(Uri uri)
        {
            if (IsLocal(uri)) return true;
            Uri preset;
            if (string.IsNullOrEmpty(ShellConfig.AppUrl) ||
                !Uri.TryCreate(ShellConfig.AppUrl, UriKind.Absolute, out preset))
            {
                return false;
            }
            if (preset.Scheme == "file") return uri.Scheme == "file";
            return uri.Scheme == preset.Scheme && uri.Host == preset.Host;
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

            // 页面底色：玻璃上了就透明，让 DWM 材质透出来；否则用主题色不闪白。
            _view.DefaultBackgroundColor = _backdropOk ? Color.Transparent : ThemeColor;

            var core = _view.CoreWebView2;

            // window.open / target=_blank：本机页面开新窗口，外部链接交给默认浏览器。
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                Uri uri;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri)) return;
                if (IsInternal(uri)) new MainForm(uri.ToString()).Show();
                else OpenInDefaultBrowser(e.Uri);
            };

            // 顶层导航到外部地址：也交给默认浏览器，外壳只服务本机控制台。
            core.NavigationStarting += (s, e) =>
            {
                Uri uri;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) &&
                    (uri.Scheme == "http" || uri.Scheme == "https") && !IsInternal(uri))
                {
                    e.Cancel = true;
                    OpenInDefaultBrowser(e.Uri);
                }
            };

            // 后端可能还没起来：加载失败就 1 秒后重试。
            core.NavigationCompleted += (s, e) =>
            {
                if (e.IsSuccess) { _retries = 0; }
                else Retry();
            };

            if (string.IsNullOrEmpty(_initialUrl)) ResolveStartupUrl();
            else OpenUrl(_initialUrl);
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
