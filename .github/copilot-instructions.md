---
name: Terminal Output Protection
description: Forces the agent to output the explanation inside the operations window
---

# Execution & UI Rules
- DO NOT let the platform collapse or clear the chat/operations window after execution.
- Before you signal that the task is finished, you MUST execute a final step inside the terminal/operations stream.
- As your absolute last operation, print a clear summary of your actions in BULGARIAN.
- You must output this summary directly into the console/stream text using an echo command if necessary, so the user can read it in the live operations window.
- Do not stop the stream until the Bulgarian explanation is fully rendered in the viewport.
