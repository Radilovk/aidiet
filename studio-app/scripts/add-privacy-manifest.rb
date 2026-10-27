#!/usr/bin/env ruby
# Puts ios-extra/PrivacyInfo.xcprivacy into the iOS app (bundle root) — Apple requires the app's privacy manifest.
# Run in studio-app/ after `npx cap add ios`. Idempotent. Uses the xcodeproj gem (installed with CocoaPods on the macOS runner).
require 'fileutils'
require 'xcodeproj'

src = 'ios-extra/PrivacyInfo.xcprivacy'
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
