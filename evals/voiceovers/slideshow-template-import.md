# slideshow-template-import - safely import and recover from `.ipwt` packages

1. I open the Slides template category and choose an `.ipwt` package.

2. iPolloWork validates the package, detects its presentation metadata, and clearly shows the selected file while installation is in progress.

3. A valid slideshow template installs once, appears in the Slides catalog, and only receives the PPTX-compatible badge when its editable-object contract is valid.

4. If the package is malformed, oversized, or not a valid slideshow, iPolloWork explains the failure without installing partial files.

5. After a failed import, the selected file remains available so I can retry or cancel without choosing it again.

6. While an import is running, duplicate submissions are prevented, and the rest of the application remains responsive.
