# Go binary

::: warning In progress
The Mock server is being ported to a single Go binary. This page will carry the download and
flags once it lands on `main`. Until then, run the Node server (`make start`) or the
[Proxmox](/run/proxmox) container.
:::

The goal: one file that serves the built app and the sign-in and sync API, with no Node
install, configured with the same variables as the [Node server](/guide/sync#server-settings).
