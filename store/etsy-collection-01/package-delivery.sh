#!/usr/bin/env bash
# Package listing delivery zips once all renders are done. Zip per ratio per listing.
set -e
cd "$(dirname "$0")"
declare -A SETS=(
  [listing1-arch-trio]="01-arc-and-sun 02-layered-arches 03-arch-botanical"
  [listing2-wabi-trio]="04-enso-sun 05-balance 06-brushfield"
  [listing3-sumi-trio]="07-ridge 08-still-lake 09-heron"
  [listing4-gallery-six]="01-arc-and-sun 02-layered-arches 04-enso-sun 05-balance 07-ridge 08-still-lake"
  [listing5-above-bed]="10-above-the-ridge"
  [listing6-single-enso]="04-enso-sun"
  [listing7-single-ridge]="07-ridge"
  [listing8-single-heron]="09-heron"
)
PORTRAIT="2x3-24x36in 3x4-18x24in 4x5-16x20in 11x14in ISO-A1"
LANDSCAPE="3x2-36x24in 4x3-24x18in 5x4-20x16in 14x11in ISO-A1-landscape"
mkdir -p delivery
for listing in "${!SETS[@]}"; do
  designs=${SETS[$listing]}
  ratios=$PORTRAIT
  [[ "$designs" == *"10-above"* ]] && ratios=$LANDSCAPE
  mkdir -p "delivery/$listing"
  for ratio in $ratios; do
    staging="delivery/$listing/ratio-$ratio"
    mkdir -p "$staging"
    for d in $designs; do cp "files/$d/${d}__${ratio}.jpg" "$staging/"; done
    cp how-to-print-guide.pdf "$staging/"
    (cd "delivery/$listing" && zip -q -r "kaze-$listing-$ratio.zip" "ratio-$ratio" && rm -rf "ratio-$ratio")
  done
done
find delivery -name '*.zip' -size +19M -exec echo "WARNING over Etsy 20MB limit: {}" \;
echo "PACKAGING COMPLETE: $(find delivery -name '*.zip' | wc -l) zips"
du -sh delivery
