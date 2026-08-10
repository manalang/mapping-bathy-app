# Bathymetry Position Mapper

A browser-based mapping tool for annotated ocean positions.

## Features

- Hand-enter positions in decimal degrees (DD)
- Hand-enter positions in degrees + decimal minutes (DM)
- Automatic DD ↔ DM conversion
- Import XLSX, XLS, CSV, or TSV spreadsheets
- Edit site labels and annotations in the browser
- Display bathymetry using the GEBCO Web Map Service
- Overlay land in sage green
- Export mapped positions to CSV
- Fit the map to all loaded positions

## Run locally

Because the app uses remote map/data libraries, the most reliable local test is through a tiny web server rather than double-clicking `index.html`.

With Python installed:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Publish with GitHub Pages

1. Create a GitHub repository.
2. Upload all files and folders in this repository.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`.
6. Save.

Your site will normally appear at:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/
```

## Spreadsheet format

Recommended columns:

| Name | Latitude | Longitude | Annotation |
|---|---:|---:|---|
| MJ01E | 44.479722 | -125.152500 | Example |

The importer also recognizes common alternatives including `Site`, `Label`, `Lat`, `Lon`, `Long`, `Lng`, `Note`, and `Description`.

## Coordinate convention

Internally, positions are stored as WGS 84 decimal degrees.

- North latitude: positive
- South latitude: negative
- East longitude: positive
- West longitude: negative

## External services and libraries

This app currently uses:

- Leaflet 1.9.4
- SheetJS/xlsx 0.18.5
- topojson-client 3.1.0
- Natural Earth land geometry distributed through world-atlas
- GEBCO `GEBCO_Latest` WMS bathymetry

Internet access is therefore required for the map and external JavaScript libraries.

## Important

GEBCO bathymetry is suitable for visualization and scientific context, but the map should **not** be used for navigation or safety-of-life decisions.

## Repository structure

```text
bathymetry-position-mapper/
├── index.html
├── css/
│   └── styles.css
├── js/
│   └── app.js
├── examples/
│   └── example_positions.csv
├── .nojekyll
└── README.md
```
