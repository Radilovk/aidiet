#!/usr/bin/env ruby
# Разрешенията на Nutriin (ios-res/App.entitlements → ios/App/App/App.entitlements) за целта App: Apple Health,
# връзките към nutriin.app / biocode.website и push. Bundle ID-то трябва да ги има (apple-connect.mjs capability —
# build-ios.yml го пуска преди подписването), за да ги носи профилът за App Store.
# Пуска се от корена след `npx cap add ios`. Идемпотентно.
require 'fileutils'
require 'xcodeproj'

FileUtils.cp('ios-res/App.entitlements', 'ios/App/App/App.entitlements')
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
group = project.main_group['App'] or abort 'group App not found'
group.new_file('App.entitlements') if group.files.none? { |f| f.path == 'App.entitlements' }
target.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
# HealthKit: системната рамка (плъгинът я ползва; изрично — за да е ясно, че приложението я използва)
unless target.frameworks_build_phase.files_references.compact.any? { |f| f.path.to_s.include?('HealthKit.framework') }
  target.add_system_framework('HealthKit')
end
project.save
puts 'App.entitlements (HealthKit, associated domains, push) and HealthKit.framework set for the App target'
