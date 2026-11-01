# Security

This overlay only talks to the League of Legends client on `127.0.0.1` (the local client API) and, when the
client is not running, to Data Dragon for champion data. It never sends anything anywhere else; your summoner
data stays on your machine. Settings and debug logs live in `%APPDATA%\aram-overlay\`; debug logs contain
your summoner name and those of your teammates, so look through them before sharing.

The release binaries are built by GitHub Actions from the tagged commit and are not code-signed.

To report a vulnerability, open a private security advisory on GitHub (Security → Report a vulnerability) rather
than a public issue.
