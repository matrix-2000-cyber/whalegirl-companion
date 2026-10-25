import 'dart:convert';
import 'dart:io';
import 'package:image/image.dart' as img;

void main() {
  final art = img.Image(width: 1024, height: 1024, numChannels: 4);
  final bg = img.ColorRgba8(231, 246, 250, 255);
  final blue = img.ColorRgba8(39, 139, 173, 255);
  final ink = img.ColorRgba8(24, 71, 93, 255);
  img.fill(art, color: bg);
  img.fillCircle(art, x: 730, y: 427, radius: 102, color: blue);
  img.fillCircle(art, x: 730, y: 596, radius: 102, color: blue);
  img.fillCircle(art, x: 651, y: 520, radius: 100, color: blue);
  img.fillCircle(art, x: 455, y: 520, radius: 270, color: blue);
  img.fillCircle(art, x: 865, y: 510, radius: 107, color: bg);
  img.fillCircle(art, x: 433, y: 650, radius: 127, color: img.ColorRgba8(184, 224, 237, 255));
  img.fillCircle(art, x: 348, y: 475, radius: 23, color: ink);
  img.fillCircle(art, x: 341, y: 468, radius: 7, color: img.ColorRgba8(255,255,255,255));
  img.drawLine(art, x1: 306, y1: 550, x2: 350, y2: 570, color: ink, thickness: 10);
  img.drawLine(art, x1: 350, y1: 570, x2: 392, y2: 556, color: ink, thickness: 10);
  img.drawLine(art, x1: 435, y1: 224, x2: 422, y2: 171, color: blue, thickness: 18);
  img.drawLine(art, x1: 432, y1: 192, x2: 476, y2: 166, color: blue, thickness: 18);
  for (final density in {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}.entries) {
    final file = File('android/app/src/main/res/mipmap-${density.key}/ic_launcher.png');
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(img.encodePng(img.copyResize(art, width: density.value, height: density.value)));
  }
  final folder = Directory('ios/Runner/Assets.xcassets/AppIcon.appiconset');
  final contents = jsonDecode(File('${folder.path}/Contents.json').readAsStringSync()) as Map;
  for (final entry in contents['images'] as List) {
    if (entry['filename'] == null) continue;
    final size = (double.parse((entry['size'] as String).split('x').first) * double.parse((entry['scale'] as String).replaceAll('x',''))).round();
    File('${folder.path}/${entry['filename']}').writeAsBytesSync(img.encodePng(img.copyResize(art, width: size, height: size)));
  }
  Directory('../out/mobile').createSync(recursive: true);
  File('../out/mobile/whalegirl-icon.png').writeAsBytesSync(img.encodePng(art));
  stdout.writeln('Original vector-style whale icons generated for Android and iOS.');
}
