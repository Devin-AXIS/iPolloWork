# slideshow-template-import - safely import `.ipwp` and legacy `.ipwt` packages

1. I open the Slides template category and choose the canonical `.ipwp` package.

2. iPolloWork validates the package, detects its presentation metadata, and clearly shows the selected file while installation is in progress.

3. A valid slideshow template installs once, appears in the Slides catalog, and only receives the PPTX-compatible badge when its editable-object contract is valid.

4. I can also import the same version-one package through its legacy `.ipwt` filename without conversion or a duplicate template.

5. If the package is malformed, oversized, or not a valid slideshow, iPolloWork explains the failure without installing partial files.

6. After a failed import, the selected file remains available so I can retry or cancel without choosing it again.

7. While an import is running, duplicate submissions are prevented, and the rest of the application remains responsive.
