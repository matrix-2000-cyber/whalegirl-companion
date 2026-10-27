using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Reflection;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("WhaleGirl Companion Setup")]
[assembly: AssemblyCompany("WhaleGirl Companion contributors")]
[assembly: AssemblyVersion("0.5.0.0")]
[assembly: AssemblyFileVersion("0.5.0.0")]
class SetupForm : Form {
 TextBox location=new TextBox(),details=new TextBox(); Label status=new Label(); ProgressBar progress=new ProgressBar();
 Button primary=new Button(),model=new Button(),logs=new Button(); CheckBox direct=new CheckBox();
 bool active=false,launchMode=false,configure=false,noProxy=false,cancelled=false; string root,data; Process child; WebClient downloader;
 JavaScriptSerializer json=new JavaScriptSerializer();
 Dictionary<string,object> state;
 static string Self=Assembly.GetExecutingAssembly().Location;
 static string Q(string value){var result=new StringBuilder("\"");int slashes=0;foreach(char c in value){if(c=='\\'){slashes++;continue;}result.Append('\\',c=='\"'?slashes*2+1:slashes);result.Append(c);slashes=0;}result.Append('\\',slashes*2);return result.Append('"').ToString();}
 static string Hash(string path){using(var s=File.OpenRead(path))using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(s)).Replace("-", "").ToLowerInvariant();}
 static void ExtractResource(string name,string target){Directory.CreateDirectory(Path.GetDirectoryName(target));using(var source=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){if(source==null)throw new Exception("Missing embedded resource: "+name);using(var output=File.Create(target))source.CopyTo(output);}}
 static void Zip(string archive,string target){
  Directory.CreateDirectory(target);string prefix=Path.GetFullPath(target).TrimEnd('\\')+"\\";
  using(var zip=ZipFile.OpenRead(archive))foreach(var entry in zip.Entries){
   if(Path.IsPathRooted(entry.FullName)||entry.FullName.Contains(":"))throw new Exception("Unsafe archive path");
   string file=Path.GetFullPath(Path.Combine(target,entry.FullName.Replace('/', '\\')));
   if(!file.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe archive path");
   if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(file);continue;}
   Directory.CreateDirectory(Path.GetDirectoryName(file));entry.ExtractToFile(file,true);
  }
 }
 public SetupForm(string[] args){
  root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","WhaleGirlCompanion");
  data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"WhaleGirlCompanionData");
  string localState=Path.Combine(Path.GetDirectoryName(Self),"installation.json");
  launchMode=args.Contains("--launch")||args.Contains("--configure");configure=args.Contains("--configure");
  if(launchMode){root=Path.GetDirectoryName(Self);state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(localState));data=(string)state["dataRoot"];}
  for(int i=0;i<args.Length-1;i++){if(args[i]=="--test-root")root=Path.GetFullPath(args[i+1]);if(args[i]=="--test-data")data=Path.GetFullPath(args[i+1]);}
  Text=launchMode?"鲸鱼娘 · 启动与设置":"鲸鱼娘 · Windows 安装向导";ClientSize=new Size(720,545);StartPosition=FormStartPosition.CenterScreen;
  Font=new Font("Microsoft YaHei UI",10F);BackColor=Color.FromArgb(16,29,31);ForeColor=Color.FromArgb(225,237,228);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
  var title=new Label{Text="鲸鱼娘  WhaleGirl Companion",Font=new Font(Font.FontFamily,21F,FontStyle.Bold),Location=new Point(30,25),AutoSize=true};Controls.Add(title);
  var intro=new Label{Text="自动准备运行环境 · 独立保存记忆与设置 · 模型账号由你自己配置",Location=new Point(32,82),Size=new Size(660,45)};Controls.Add(intro);
  location.SetBounds(32,135,654,30);location.Text=root;location.ReadOnly=launchMode;Controls.Add(location);
  direct.SetBounds(32,178,640,28);direct.Text="直接连接下载（不使用系统代理；不改变电脑代理设置）";direct.Visible=!launchMode;Controls.Add(direct);
  status.SetBounds(32,220,655,48);status.Text=launchMode?"正在准备启动…":"Windows 10/11 x64 · 首次安装需要联网下载组件与模型";Controls.Add(status);
  progress.SetBounds(32,276,654,12);Controls.Add(progress);
  details.SetBounds(32,308,654,125);details.Multiline=true;details.ReadOnly=true;details.ScrollBars=ScrollBars.Vertical;details.BackColor=Color.FromArgb(10,21,23);details.ForeColor=ForeColor;details.BorderStyle=BorderStyle.FixedSingle;Controls.Add(details);
  primary.SetBounds(510,466,176,42);primary.Text=launchMode?"开始聊天":"安装 / 修复";primary.BackColor=Color.FromArgb(185,211,176);primary.ForeColor=Color.FromArgb(15,35,28);primary.FlatStyle=FlatStyle.Flat;primary.Click+=(s,e)=>{if(launchMode)OpenChat();else BeginInstall();};Controls.Add(primary);
  model.SetBounds(32,466,175,42);model.Text="打开模型设置";model.Enabled=false;model.Click+=(s,e)=>OpenUrl("http://127.0.0.1:3180/");Controls.Add(model);
  logs.SetBounds(225,466,160,42);logs.Text="查看本机日志";logs.Click+=(s,e)=>{Directory.CreateDirectory(Path.Combine(data,"logs"));OpenUrl(Path.Combine(data,"logs"));};Controls.Add(logs);
  foreach(var button in new[]{model,logs}){button.BackColor=Color.FromArgb(35,58,61);button.ForeColor=ForeColor;button.FlatStyle=FlatStyle.Flat;}
  FormClosing+=(s,e)=>{if(active){if(MessageBox.Show("停止本次安装？已下载的文件和原有数据会保留，稍后可重新运行。",Text,MessageBoxButtons.YesNo)!=DialogResult.Yes){e.Cancel=true;return;}cancelled=true;if(downloader!=null)downloader.CancelAsync();if(child!=null&&!child.HasExited){var stop=Process.Start(new ProcessStartInfo("taskkill.exe","/PID "+child.Id+" /T /F"){UseShellExecute=false,CreateNoWindow=true});stop.WaitForExit();}}};
  Shown+=(s,e)=>{if(launchMode)BeginLaunch();};
 }
 void Note(string line){if(IsDisposed)return;BeginInvoke((Action)(()=>{if(line.StartsWith("STATUS|"))status.Text=line.Substring(7);details.AppendText(line+Environment.NewLine);}));}
 void Finish(bool ok,string message){if(IsDisposed||cancelled)return;BeginInvoke((Action)(()=>{active=false;progress.Style=ProgressBarStyle.Blocks;primary.Enabled=true;location.Enabled=true;status.Text=message;if(ok){model.Enabled=true;primary.Text="开始聊天";launchMode=true;if(!configure&&state!=null&&state.ContainsKey("configured")&&(bool)state["configured"]){OpenUrl("http://127.0.0.1:3192/");Close();}}}));}
 void Background(Action task){active=true;primary.Enabled=false;location.Enabled=false;progress.Style=ProgressBarStyle.Marquee;System.Threading.Tasks.Task.Run(()=>{try{task();}catch(Exception ex){Finish(false,"当前步骤未完成："+ex.Message);}});}
 void Run(string exe,string arguments){
  var start=new ProcessStartInfo(exe,arguments){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
  start.EnvironmentVariables["NODE_USE_ENV_PROXY"]="1";
  if(noProxy){foreach(string name in new[]{"HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"})start.EnvironmentVariables.Remove(name);}
  else if(String.IsNullOrEmpty(start.EnvironmentVariables["HTTPS_PROXY"])) {var origin=new Uri("https://registry.npmjs.org/");var proxy=WebRequest.DefaultWebProxy.GetProxy(origin);if(proxy!=origin){start.EnvironmentVariables["HTTPS_PROXY"]=proxy.AbsoluteUri;start.EnvironmentVariables["HTTP_PROXY"]=proxy.AbsoluteUri;}}
  child=new Process{StartInfo=start};child.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Note(e.Data);};child.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Note(e.Data);};child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();child.WaitForExit();if(child.ExitCode!=0)throw new Exception("安装未完成，请根据上方提示重试（原数据保留）");
 }
 void BeginInstall(){
  root=Path.GetFullPath(location.Text);noProxy=direct.Checked;if(root==Path.GetPathRoot(root)){MessageBox.Show("请选择专用文件夹");return;}
  for(string path=root;path!=null;path=Path.GetDirectoryName(path))if(Directory.Exists(path)&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0){MessageBox.Show("请选择不含链接或目录联接的安装路径");return;}
  if(Directory.Exists(root)&&!File.Exists(Path.Combine(root,"installation.json"))&&!File.Exists(Path.Combine(root,"install.inprogress.json"))&&Directory.GetFileSystemEntries(root).Any(p=>!new[]{"staging","runtime","cache","WhaleGirl.exe"}.Contains(Path.GetFileName(p)))){MessageBox.Show("请选择空文件夹或原有鲸鱼娘安装文件夹");return;}
  Background(()=>{
   string staging=Path.Combine(root,"staging",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(staging);
   string package=Path.Combine(staging,"app.zip"),scripts=Path.Combine(staging,"scripts.zip");ExtractResource("app.zip",package);ExtractResource("scripts.zip",scripts);Zip(scripts,Path.Combine(staging,"installer"));
   var manifest=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(staging,"installer","dependencies.json")));
   var entries=(System.Collections.IEnumerable)manifest["items"];Dictionary<string,object> node=null;
   foreach(Dictionary<string,object> item in entries)if((string)item["id"]=="node")node=item;
   string nodeExe=Path.Combine(root,"runtime","node","node-v24.20.0-win-x64","node.exe");
   if(!File.Exists(nodeExe)){
    Note("STATUS|下载并校验 Node.js");string archive=Path.Combine(staging,"node.zip");
    ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
    using(var client=new WebClient()){downloader=client;if(noProxy)client.Proxy=null;client.DownloadFileTaskAsync(new Uri((string)node["url"]),archive).GetAwaiter().GetResult();downloader=null;}
    if(cancelled)return;
    if(Hash(archive)!=(string)node["sha256"])throw new Exception("Node.js 校验失败，未执行下载文件");Zip(archive,Path.Combine(root,"runtime","node"));
   }
   Run(nodeExe,Q(Path.Combine(staging,"installer","install.mjs"))+" --root "+Q(root)+" --data "+Q(data)+" --package "+Q(package));
   string installed=Path.Combine(root,"WhaleGirl.exe");if(!String.Equals(Self,installed,StringComparison.OrdinalIgnoreCase))File.Copy(Self,installed,true);
   state=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"installation.json")));
   CreateShortcut("鲸鱼娘",installed,"--launch");CreateShortcut("鲸鱼娘设置",installed,"--configure");
   Run(nodeExe,Q(Path.Combine(root,"launcher","launch.mjs"))+" "+Q(root));
   Finish(true,"准备完成。请先打开模型设置，登录并选择模型，再开始聊天。");
  });
 }
 void BeginLaunch(){Background(()=>{Run((string)state["node"],Q(Path.Combine(root,"launcher","launch.mjs"))+" "+Q(root));Finish(true,"服务已启动。首次使用请先登录并选择自己的模型。");});}
 void OpenChat(){if(active)return;if(state==null){BeginLaunch();return;}state["configured"]=true;File.WriteAllText(Path.Combine(root,"installation.json"),json.Serialize(state),new UTF8Encoding(false));OpenUrl("http://127.0.0.1:3192/");Close();}
 static void OpenUrl(string value){Process.Start(new ProcessStartInfo(value){UseShellExecute=true});}
 static void CreateShortcut(string name,string target,string args){
  Type type=Type.GetTypeFromProgID("WScript.Shell");dynamic shell=Activator.CreateInstance(type);dynamic shortcut=shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),name+".lnk"));shortcut.TargetPath=target;shortcut.Arguments=args;shortcut.WorkingDirectory=Path.GetDirectoryName(target);shortcut.Save();
 }
 [STAThread]static int Main(string[] args){
  try{
   if(args.Length==2&&args[0]=="--inspect-package"){Directory.CreateDirectory(args[1]);ExtractResource("app.zip",Path.Combine(args[1],"app.zip"));ExtractResource("scripts.zip",Path.Combine(args[1],"scripts.zip"));return 0;}
   if(!Environment.Is64BitOperatingSystem)throw new Exception("此版本需要64位Windows");
   Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new SetupForm(args));return 0;
  }catch(Exception ex){MessageBox.Show(ex.Message,"鲸鱼娘安装向导");return 1;}
 }
}
