#!/usr/bin/env ruby
# Слага ios-res/PrivacyInfo.xcprivacy в приложението (в корена на пакета) — Apple изисква манифест за поверителност.
# Пуска се от корена след `npx cap add ios`. Идемпотентно. Нужен е гемът xcodeproj (build-ios.yml го инсталира).
require 'fileutils'
require 'xcodeproj'

src = 'ios-res/PrivacyInfo.xcprivacy'
dst = 'ios/App/App/PrivacyInfo.xcprivacy'
abort "#{src} not found" unless File.exist?(src)
FileUtils.cp(src, dst)

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
group = project.main_group['App'] or abort 'group App not found'

if group.files.none? { |f| f.path == 'PrivacyInfo.xcprivacy' }
  ref = group.new_file('PrivacyInfo.xcprivacy')
  target.resources_build_phase.add_file_reference(ref)
  project.save
  puts 'PrivacyInfo.xcprivacy added to the App target'
else
  puts 'PrivacyInfo.xcprivacy already in the project'
end
