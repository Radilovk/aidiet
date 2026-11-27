#!/usr/bin/env ruby
# Добавя собствения Swift код на Nutriin (ios-res/App/*.swift — плъгини и главният екран) към целта App.
# Пуска се от корена след `npx cap add ios`. Идемпотентно. Нужен е гемът xcodeproj.
require 'fileutils'
require 'xcodeproj'

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' } or abort 'target App not found'
group = project.main_group['App'] or abort 'group App not found'

Dir['ios-res/App/*.swift'].sort.each do |src|
  name = File.basename(src)
  FileUtils.cp(src, "ios/App/App/#{name}")
  next if group.files.any? { |f| f.path == name }
  target.source_build_phase.add_file_reference(group.new_file(name))
  puts "#{name} added to the App target"
end
project.save
