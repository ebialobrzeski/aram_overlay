# Building releases on the NAS

GitHub-hosted runners are not available for this account, so the Windows packages are built on the NAS
(UGREEN DXP4800 Plus, Docker) and uploaded to the GitHub release of a tag. Same idea as staffium's
`deploy/nas/deploy.sh`: the NAS has a clone of the repo and a script that does everything.

```
laptop                      GitHub                         NAS (/volume2/docker/aram_overlay)
git tag v0.2.0 && push ──► tag v0.2.0            make release TAG=v0.2.0 ──► release.sh:
                                                                               fetch tag, npm ci, tests,
                            release v0.2.0  ◄──── electron-builder --publish ── installer + portable exe
```

## One-time setup on the NAS

1. **GitHub token**: *Settings → Developer settings → Personal access tokens → Tokens (classic)*, scope `repo`
   (the repo is private: the token is used both to clone and to publish the release).
2. SSH to the NAS and clone the repo:
   ```sh
   cd /volume2/docker
   sudo git clone https://<TOKEN>@github.com/ebialobrzeski/aram_overlay.git
   # no git on the system? use a container:
   # sudo docker run --rm -v /volume2/docker:/w -w /w alpine/git clone https://<TOKEN>@github.com/ebialobrzeski/aram_overlay.git
   ```
3. Put the token where the script reads it:
   ```sh
   cd /volume2/docker/aram_overlay/deploy/nas
   sudo cp env.example .env && sudo chmod 600 .env
   sudo sed -i 's/^GH_TOKEN=$/GH_TOKEN=<TOKEN>/' .env
   ```
4. Test build without publishing (the first run pulls the ~2 GB builder image and Electron, later runs reuse the caches):
   ```sh
   sudo /volume2/docker/aram_overlay/deploy/nas/release.sh --no-publish
   ls /volume2/docker/aram_overlay/release/
   ```

## Releasing

On the laptop:

```sh
# bump "version" in package.json, commit, then
git tag v0.2.0 && git push origin main --tags
make release TAG=v0.2.0          # ssh admin@nas.local 'sudo .../release.sh v0.2.0'
```

`make release` without `TAG` builds the newest `v*` tag. The script checks out the tag, runs `npm ci` and the
tests inside `electronuserland/builder:wine`, builds `ARAM Comp Overlay-<version>-win-x64.exe` (installer) and
`ARAM Comp Overlay-<version>-portable.exe`, and `electron-builder --publish always` creates or updates the GitHub
release `v<version>` with both files (plus `latest.yml` and the blockmap, harmless extras).

Override the NAS address: `make release NAS=user@192.168.1.10`.

## Troubleshooting

- **`GH_TOKEN missing`** – step 3 above.
- **`tag vX does not exist on origin`** – push the tag first (`git push origin --tags`).
- **Build works but the release has no files** – the token lacks the `repo` scope, or the release for that tag
  was created manually as a draft with a different name; electron-builder looks for a release tagged `v<version>`.
- **Docker cannot reach github.com** – the NAS needs outbound HTTPS for npm, Electron and the GitHub API.
- **Disk**: the builder image is about 2 GB, caches about 500 MB, each build output about 160 MB.
