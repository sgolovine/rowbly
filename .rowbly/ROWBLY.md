# Rowbly Instructions

- When spawning worker agents, spawn either the latest Claude Opus model or the latest GPT Sol model.
- Use a mix of Claude Opus and GPT Sol threads.
- Prefer Claude Opus for development.
- Prefer GPT Sol for bug fixes and investigation.
- Always run the factory through T3 Code.
- Check the remaining usage through T3 Code before you start each new thread.
- Prefer Claude Opus unless its remaining usage is low. Then use GPT Sol.
- First try to start work on the remote development machine `rook`, if you can connect to it.
- Run a maximum of five threads at one time on `rook`.
- Run a maximum of three threads at one time on `thinkpad`, this computer.
