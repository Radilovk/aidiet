#!/usr/bin/env ruby
# Puts the manual signing (the App Store profile made by scripts/apple-signing.mjs) into the App target only
# (not into the Capacitor plugin packages). Run in studio-app/ after `npx cap add ios` and `apple-signing.mjs prepare`.
# Env: PROFILE_NAME, APPLE_TEAM_ID, SIGN_KEYCHAIN. Idempotent.
require 'xcodeproj'

profile = ENV['PROFILE_NAME'] or abort 'PROFILE_NAME is not set'
team = ENV['APPLE_TEAM_ID'] or abort 'APPLE_TEAM_ID is not set'
keychain = ENV['SIGN_KEYCHAIN']

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
target.build_configurations.each do |c|
  s = c.build_settings
  s['CODE_SIGN_STYLE'] = 'Manual'
  s['DEVELOPMENT_TEAM'] = team
  s['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
  s['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = 'Apple Distribution'
  s['PROVISIONING_PROFILE_SPECIFIER'] = profile
  s['OTHER_CODE_SIGN_FLAGS'] = "--keychain #{keychain}" if keychain && !keychain.empty?
end
project.save
puts "App target: manual signing, profile \"#{profile}\", team #{team}"
