# Custom appearance

Open **Settings → Custom appearance**. Name the app and upload a PNG, JPEG, or WebP logo. Save to apply them to the sidebar, the conversation home, and the page title and icon. The Host also uses the saved identity on the boot page.

The preset choices apply in one click. **My skin** remembers independent light and dark values for primary, secondary, text, and background colors. DSH's existing light, dark, and system preference chooses which set to display. **Default** restores the installed theme while retaining the saved brand and custom colors.

The plugin stores appearance in the current DSH Host profile. Host owners can edit it. The logo is served as a bounded raster PNG for the startup screen. The operating system's installed app name and icon are set by the installer.

The iPolloWork Suite includes this plugin as `ipollo-custom-appearance`. It can also be built and installed as `@ipollo/dsh-custom-appearance` in a separate DSH profile. From this package, run `npm ci`, `npm run check`, and `npm run pack:check` with the pinned DSH setup in place.
