# =========================================================================
# قانون تاهيرو — ضبط مشروع Xcode بعد توليده (GitHub Actions، macOS)، بجوهرة xcodeproj:
#   • الإصدار: MARKETING_VERSION من package.json، ورقم البناء CURRENT_PROJECT_VERSION يزيد في كل بناء (شرط TestFlight)
#   • iPhone وحده (TARGETED_DEVICE_FAMILY = 1): لا لقطات iPad مطلوبة في App Store
#   • التوقيع اليدوي لهدف التطبيق App وحده في إعداد Release: شهادة التوزيع (Apple Distribution) وملف التعريف المرفوع في الأسرار.
#     (لا يُمرَّر التوقيع في سطر أوامر xcodebuild لأنه يسري حينها على حزم Swift أيضاً فيفشل البناء)
#   • PrivacyInfo.xcprivacy (يكتبه scripts/qt-ios-hook.cjs) يُضاف إلى موارد التطبيق
# المتغيرات: QT_VERSION  QT_BUILD  [QT_TEAM  QT_PROFILE_NAME  QT_SIGN_IDENTITY] — دون الفريق والملف لا يُضبط توقيع (بناء للمحاكي فقط)
#   ruby scripts/qt-ios-project.rb
# =========================================================================
require 'xcodeproj'

path = File.join('ios', 'App', 'App.xcodeproj')
abort "✗ لا يوجد #{path}: شغّل npx cap add ios أولاً" unless File.directory?(path)
project = Xcodeproj::Project.open(path)
target = project.targets.find { |t| t.name == 'App' } or abort '✗ لا هدف باسم App في مشروع Xcode'

version = (ENV['QT_VERSION'] || '').strip
build = (ENV['QT_BUILD'] || '').strip
team = (ENV['QT_TEAM'] || '').strip
profile = (ENV['QT_PROFILE_NAME'] || '').strip
identity = (ENV['QT_SIGN_IDENTITY'] || '').strip
identity = 'Apple Distribution' if identity.empty?
abort '✗ QT_VERSION بصيغة 8.0.0' unless version =~ /\A\d+\.\d+\.\d+\z/
abort '✗ QT_BUILD عدد صحيح' unless build =~ /\A\d+\z/

target.build_configurations.each do |c|
  s = c.build_settings
  s['MARKETING_VERSION'] = version
  s['CURRENT_PROJECT_VERSION'] = build
  s['TARGETED_DEVICE_FAMILY'] = '1'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.qanontahiro.app'
  next unless c.name == 'Release' && !team.empty? && !profile.empty?
  s['CODE_SIGN_STYLE'] = 'Manual'
  s['DEVELOPMENT_TEAM'] = team
  s['CODE_SIGN_IDENTITY'] = identity
  s['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = identity
  s['PROVISIONING_PROFILE_SPECIFIER'] = profile
  s.delete('PROVISIONING_PROFILE')
end

pi = File.join('ios', 'App', 'App', 'PrivacyInfo.xcprivacy')
if File.exist?(pi)
  group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' && g.is_a?(Xcodeproj::Project::Object::PBXGroup) } || project.main_group
  unless target.resources_build_phase.files_references.any? { |f| f && f.path.to_s.end_with?('PrivacyInfo.xcprivacy') }
    ref = group.files.find { |f| f.path == 'PrivacyInfo.xcprivacy' } || group.new_reference('PrivacyInfo.xcprivacy')
    target.resources_build_phase.add_file_reference(ref, true)
  end
end

project.save
signed = !team.empty? && !profile.empty?
puts "✓ App: الإصدار #{version} (#{build})، iPhone وحده#{signed ? "، توقيع Release بالفريق #{team} وملف «#{profile}»" : '، دون توقيع (بناء للمحاكي)'}#{File.exist?(pi) ? '، وPrivacyInfo.xcprivacy في الموارد' : ''}"
