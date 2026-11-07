#!/usr/bin/env ruby
# The app's entitlements and its own notification sound, for the App target (Release and Debug):
#   ios-extra/App.entitlements → ios/App/App/App.entitlements  (push: aps-environment; associated domains: biocode.website)
#   ios-extra/studio.wav       → the app bundle                 (the soft chime of the reminders and push notifications)
# The Bundle ID needs the same capabilities (apple-connect.mjs capability — the iOS workflow runs it before signing),
# so that the App Store profile made for each build carries them.
# Run in studio-app/ after `npx cap add ios`. Idempotent.
require 'fileutils'
require 'xcodeproj'

%w[App.entitlements studio.wav].each do |f|
  abort "ios-extra/#{f} not found" unless File.exist?("ios-extra/#{f}")
  FileUtils.cp("ios-extra/#{f}", "ios/App/App/#{f}")
end

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
group = project.main_group['App'] or abort 'group App not found'
group.new_file('App.entitlements') if group.files.none? { |f| f.path == 'App.entitlements' }
if group.files.none? { |f| f.path == 'studio.wav' }
  target.resources_build_phase.add_file_reference(group.new_file('studio.wav'))
end
target.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
project.save
puts 'App.entitlements (push, associated domains) and studio.wav set for the App target'
