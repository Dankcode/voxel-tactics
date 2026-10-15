# Shared development and visual testing

Claude and Codex use the same checkout, map packages, renderer, assets, and launch flow.

- Start `npm run dev` from the repository root. It serves the live client and co-op backend together at `http://localhost:2567/`.
- Use `http://localhost:2567/?play=burger-district&seed=1` as the shared visual testing baseline. Burger District's authored package and design are the default; use other maps only for a task-specific test.
- Reuse the running shared server. Do not start a separate Vite preview or another agent-specific build. Port 5173 is a compatibility redirect.
- `npm run play` builds and serves the same application at port 2567 for production checks. Stop development before starting it.
- Preserve the existing authored map designs and character/UI work when changing mechanics. See `docs/BURGER-DISTRICT-PARCELS.md` and the development instructions in `README.md`.
