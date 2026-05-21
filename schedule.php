<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Запази час</title>
  <style>
    body { margin: 0; background: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; color: #555; }
    p { text-align: center; }
  </style>
  <script>
    (function () {
      // Redirect to Acuity Scheduling, preserving all query parameters.
      // This file exists so that https://biocode.website/schedule.php?owner=...&appointmentType=...
      // works as a direct shareable booking link (GitHub Pages static file – no backend needed).
      var params = window.location.search;
      window.location.replace('https://app.acuityscheduling.com/schedule.php' + params);
    })();
  </script>
</head>
<body>
  <p>Пренасочване към формата за записване…</p>
</body>
</html>
