#!/usr/bin/env ruby
# The app's entitlements (ios-extra/App.entitlements → ios/App/App/App.entitlements) for the App target, Release and Debug:
# Time Sensitive Notifications for the reminders of the client's own booked hours. The Bundle ID needs the same capability
# (apple-connect.mjs capability), so that the App Store profile made for each build carries it.
# Run in studio-app/ after `npx cap add ios`. Idempotent.
require 'fileutils'
require 'xcodeproj'

src = 'ios-extra/App.entitlements'
dst = 'ios/App/App/App.entitlements'
abort "#{src} not found" unless File.exist?(src)
FileUtils.cp(src, dst)

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
group = project.main_group['App'] or abort 'group App not found'
group.new_file('App.entitlements') if group.files.none? { |f| f.path == 'App.entitlements' }
target.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }
project.save
puts 'App.entitlements set for the App target (time-sensitive notifications)'
