(() => {
  const accent = '#486b5c';
  const STORAGE_KEY = 'bathymetry-position-mapper.positions.v1';
  const SPLIT_STORAGE_KEY = 'bathymetry-position-mapper.split.v1';
  // Keep the map inside one Web Mercator world. Repeated worlds cause a WMS
  // server to return geographically unrelated images beside the valid map.
  const worldBounds = L.latLngBounds(
    [-85.05112878, -180],
    [85.05112878, 180]
  );
  const map = L.map('map', {
    worldCopyJump: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1,
    minZoom: 2,
    maxZoom: 22
  }).setView([44.5, -125], 6);

  // GEBCO 2026 shaded relief WMS
  const bathy = L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
    layers:'GEBCO_Latest',
    format:'image/jpeg',
    transparent:false,
    version:'1.3.0',
    crs:L.CRS.EPSG3857,
    noWrap:true,
    bounds:worldBounds,
    updateWhenZooming:false,
    keepBuffer:2,
    maxZoom:22,
    crossOrigin:true,
    attribution:'GEBCO Compilation Group — latest WMS'
  }).addTo(map);

  // NOAA's cached global bathymetric contours are a transparent Web Mercator overlay.
  const contours = L.tileLayer(
    'https://coast.noaa.gov/arcgis/rest/services/OceanReports/BathymetricContours/MapServer/tile/{z}/{y}/{x}',
    {
      noWrap:true,
      bounds:worldBounds,
      minZoom:2,
      maxNativeZoom:16,
      maxZoom:22,
      opacity:1,
      zIndex:350,
      crossOrigin:true,
      attribution:'Bathymetric contours — NOAA Office for Coastal Management'
    }
  );

  const status = document.getElementById('status');
  bathy.on('load', () => { status.textContent = 'GEBCO bathymetry loaded.'; });
  bathy.on('tileerror', () => { status.textContent = 'GEBCO bathymetry tile error — check internet access or WMS availability.'; });

  L.control.scale({imperial:false,metric:true}).addTo(map);

  let points = [];
  let sortState = {key:null, direction:1};
  const markerLayer = L.layerGroup().addTo(map);
  const annotationLayer = L.layerGroup().addTo(map);
  const contourLabelLayer = L.layerGroup();
  const highlightLayer = L.layerGroup().addTo(map);
  const measurementLayer = L.layerGroup().addTo(map);
  let contourLabelRequest = 0;

  L.control.layers({}, {
    'GEBCO bathymetry': bathy,
    'Depth contours': contours,
    'Position annotations': annotationLayer,
    'Measurement': measurementLayer
  }, {
    collapsed:false
  }).addTo(map);

  const el = id => document.getElementById(id);
  const nameEl = el('name'), noteEl = el('note');
  const coordMode = el('coordMode'), displayMode = el('displayMode');

  function setSaveState(message) {
    const saveState = el('saveState');
    if (saveState) saveState.textContent = message;
  }

  function savePoints() {
    try {
      const stored = points.map(({name,lat,lon,depth,note,visible,color}) => ({name,lat,lon,depth,note,visible,color}));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      setSaveState(points.length ? `${points.length} saved locally` : 'Auto-save on');
    } catch (err) {
      console.warn('Could not save positions in this browser.', err);
      setSaveState('Auto-save unavailable');
    }
  }

  function restorePoints() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return 0;
      points = stored
        .map(p => ({...p, lat:Number(p.lat), lon:Number(p.lon), depth:parseDepth(p.depth)}))
        .filter(p => validate(p.lat,p.lon) && !Number.isNaN(p.depth))
        .map((p,index) => ({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+index+Math.random()),
          name: String(p.name || `P${index+1}`),
          lat:p.lat,
          lon:p.lon,
          depth:p.depth,
          note:String(p.note || ''),
          visible:p.visible !== false,
          color:/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : accent
        }));
      return points.length;
    } catch (err) {
      console.warn('Could not restore saved positions.', err);
      return 0;
    }
  }
  const ddEntry = el('ddEntry'), dmEntry = el('dmEntry');

  let measuring=false;
  let measurePointerId=null;
  let measureStart=null;
  let measureLine=null;

  function formatDistanceKm(meters) {
    const km=meters/1000;
    if (km < 0.1) return `${km.toFixed(3)} km`;
    if (km < 10) return `${km.toFixed(2)} km`;
    if (km < 100) return `${km.toFixed(1)} km`;
    return `${Math.round(km)} km`;
  }

  function clearMeasurement() {
    measurementLayer.clearLayers();
    measureStart=null;
    measureLine=null;
    el('clearMeasureBtn').disabled=true;
  }

  function setMeasuring(enabled) {
    measuring=enabled;
    el('measureBtn').classList.toggle('active', enabled);
    el('measureBtn').setAttribute('aria-pressed', String(enabled));
    el('measureBtn').textContent=enabled ? 'Measuring: drag on map' : 'Measure distance';
    document.body.classList.toggle('measure-mode', enabled);
    if (enabled) {
      map.dragging.disable();
      status.textContent='Drag a straight line on the map to measure distance.';
    } else {
      map.dragging.enable();
      measurePointerId=null;
      measureStart=null;
      status.textContent='Distance measurement finished.';
    }
  }

  el('measureBtn').addEventListener('click', () => setMeasuring(!measuring));
  el('clearMeasureBtn').addEventListener('click', clearMeasurement);

  const mapContainer=map.getContainer();
  mapContainer.addEventListener('pointerdown', event => {
    if (!measuring || event.button !== 0 || event.target.closest('.leaflet-control')) return;
    event.preventDefault();
    measurePointerId=event.pointerId;
    mapContainer.setPointerCapture(event.pointerId);
    clearMeasurement();
    measureStart=map.mouseEventToLatLng(event);
    const endpointStyle={
      radius:5,color:'#ffffff',weight:2,fillColor:'#e65100',fillOpacity:1,interactive:false
    };
    L.circleMarker(measureStart, endpointStyle).addTo(measurementLayer);
    measureLine=L.polyline([measureStart,measureStart], {
      color:'#e65100',weight:4,opacity:0.95,dashArray:'10 6',interactive:false
    }).addTo(measurementLayer);
    measureLine.bindTooltip('0.000 km', {
      permanent:true,direction:'center',className:'measurement-label',opacity:1
    }).openTooltip(measureStart);
  });

  mapContainer.addEventListener('pointermove', event => {
    if (!measuring || event.pointerId !== measurePointerId || !measureStart || !measureLine) return;
    event.preventDefault();
    const end=map.mouseEventToLatLng(event);
    measureLine.setLatLngs([measureStart,end]);
    const midpoint=L.latLng(
      (measureStart.lat+end.lat)/2,
      (measureStart.lng+end.lng)/2
    );
    measureLine.setTooltipContent(formatDistanceKm(map.distance(measureStart,end)));
    measureLine.openTooltip(midpoint);
  });

  function finishMeasurement(event) {
    if (event.pointerId !== measurePointerId || !measureStart || !measureLine) return;
    const end=map.mouseEventToLatLng(event);
    if (map.distance(measureStart,end) < 0.01) {
      clearMeasurement();
    } else {
      L.circleMarker(end, {
        radius:5,color:'#ffffff',weight:2,fillColor:'#e65100',fillOpacity:1,interactive:false
      }).addTo(measurementLayer);
      el('clearMeasureBtn').disabled=false;
      status.textContent=`Measured ${formatDistanceKm(map.distance(measureStart,end))}.`;
    }
    if (mapContainer.hasPointerCapture(event.pointerId)) {
      mapContainer.releasePointerCapture(event.pointerId);
    }
    measurePointerId=null;
    measureStart=null;
    measureLine=null;
  }

  mapContainer.addEventListener('pointerup', finishMeasurement);
  mapContainer.addEventListener('pointercancel', event => {
    if (event.pointerId === measurePointerId) {
      clearMeasurement();
      measurePointerId=null;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && measuring) setMeasuring(false);
  });

  function dmToDD(deg, min, hem) {
    let v = Math.abs(Number(deg)) + Number(min)/60;
    if (hem === 'S' || hem === 'W') v *= -1;
    return v;
  }

  function ddToDM(value, isLat) {
    const v = Number(value);
    const hem = isLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
    const a = Math.abs(v);
    const deg = Math.floor(a);
    const min = (a - deg) * 60;
    return {deg, min, hem};
  }

  function dmString(value, isLat) {
    const x = ddToDM(value, isLat);
    return `${x.deg}° ${x.min.toFixed(5)}′ ${x.hem}`;
  }

  function validate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function parseDepth(value) {
    if (value === '' || value === null || value === undefined) return null;
    const depth = Number(value);
    return Number.isFinite(depth) && depth >= 0 ? depth : NaN;
  }

  coordMode.addEventListener('change', () => {
    const dm = coordMode.value === 'dm';
    ddEntry.style.display = dm ? 'none' : '';
    dmEntry.style.display = dm ? '' : 'none';
  });

  displayMode.addEventListener('change', () => {
    document.body.classList.toggle('mode-dd-only', displayMode.value === 'dd');
    document.body.classList.toggle('mode-dm-only', displayMode.value === 'dm');
  });

  function clearEntry() {
    ['name','depth','note','latDD','lonDD','latDeg','latMin','lonDeg','lonMin'].forEach(id => el(id).value='');
    el('latHem').value='N';
    el('lonHem').value='W';
  }

  function readEntryCoordinates() {
    if (coordMode.value === 'dd') {
      return {lat:Number(el('latDD').value), lon:Number(el('lonDD').value)};
    }
    return {
      lat:dmToDD(el('latDeg').value, el('latMin').value, el('latHem').value),
      lon:dmToDD(el('lonDeg').value, el('lonMin').value, el('lonHem').value)
    };
  }

  function addPosition(p, fit=true) {
    if (!validate(p.lat,p.lon)) {
      alert('Please enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return false;
    }
    const depth = parseDepth(p.depth);
    if (Number.isNaN(depth)) {
      alert('Depth must be blank or a non-negative number in meters.');
      return false;
    }
    points.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()),
      name: p.name || `P${points.length+1}`,
      lat: Number(p.lat),
      lon: Number(p.lon),
      depth,
      note: p.note || '',
      visible:p.visible !== false,
      color:/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : accent
    });
    render();
    if (fit) fitMap();
    return true;
  }

  el('addBtn').addEventListener('click', () => {
    const c = readEntryCoordinates();
    if (addPosition({name:nameEl.value.trim(),depth:el('depth').value,note:noteEl.value.trim(),...c})) clearEntry();
  });
  el('clearBtn').addEventListener('click', clearEntry);

  function render() {
    el('count').textContent = points.length;
    const tb = el('tbody');
    tb.innerHTML = '';

    const displayedPoints = [...points].sort((a,b) => {
      if (!sortState.key) return 0;
      let av=a[sortState.key], bv=b[sortState.key];
      if (sortState.key === 'name' || sortState.key === 'note') {
        return String(av || '').localeCompare(String(bv || '')) * sortState.direction;
      }
      av = av === null ? Infinity : Number(av);
      bv = bv === null ? Infinity : Number(bv);
      return (av-bv) * sortState.direction;
    });

    for (const p of displayedPoints) {
      const tr = document.createElement('tr');
      tr.classList.toggle('position-hidden', !p.visible);

      const selected = document.createElement('td');
      selected.className='select-col';
      const selectedIn = document.createElement('input');
      selectedIn.type='checkbox'; selectedIn.checked=p.visible;
      selectedIn.setAttribute('aria-label', `Show ${p.name} on map`);
      selectedIn.addEventListener('change', () => {
        p.visible=selectedIn.checked;
        tr.classList.toggle('position-hidden', !p.visible);
        renderMarkers(); savePoints();
      });
      selected.appendChild(selectedIn); tr.appendChild(selected);

      const site = document.createElement('td');
      const siteIn = document.createElement('input');
      siteIn.value = p.name;
      siteIn.addEventListener('change', () => { p.name=siteIn.value; renderMarkers(); savePoints(); });
      site.appendChild(siteIn);
      tr.appendChild(site);

      const latDD = document.createElement('td');
      latDD.className='coords-dd';
      const latIn = document.createElement('input');
      latIn.type='number'; latIn.step='any'; latIn.value=p.lat.toFixed(7);
      latIn.addEventListener('change', () => {
        const v=Number(latIn.value); if(validate(v,p.lon)){p.lat=v;renderMarkers();savePoints();} else {latIn.value=p.lat.toFixed(7);}
      });
      latDD.appendChild(latIn); tr.appendChild(latDD);

      const lonDD = document.createElement('td');
      lonDD.className='coords-dd';
      const lonIn = document.createElement('input');
      lonIn.type='number'; lonIn.step='any'; lonIn.value=p.lon.toFixed(7);
      lonIn.addEventListener('change', () => {
        const v=Number(lonIn.value); if(validate(p.lat,v)){p.lon=v;renderMarkers();savePoints();} else {lonIn.value=p.lon.toFixed(7);}
      });
      lonDD.appendChild(lonIn); tr.appendChild(lonDD);

      const latDM = document.createElement('td'); latDM.className='coords-dm'; latDM.textContent=dmString(p.lat,true); tr.appendChild(latDM);
      const lonDM = document.createElement('td'); lonDM.className='coords-dm'; lonDM.textContent=dmString(p.lon,false); tr.appendChild(lonDM);

      const depth = document.createElement('td');
      const depthIn = document.createElement('input');
      depthIn.type='number'; depthIn.min='0'; depthIn.step='1'; depthIn.value=p.depth === null ? '' : Math.round(p.depth);
      depthIn.addEventListener('change', () => {
        const v=parseDepth(depthIn.value);
        if(!Number.isNaN(v)){p.depth=v === null ? null : Math.round(v);depthIn.value=p.depth ?? '';renderMarkers();savePoints();} else {depthIn.value=p.depth === null ? '' : Math.round(p.depth);}
      });
      depth.appendChild(depthIn); tr.appendChild(depth);

      const color = document.createElement('td');
      const colorIn = document.createElement('input');
      colorIn.type='color'; colorIn.value=p.color;
      colorIn.setAttribute('aria-label', `Marker color for ${p.name}`);
      colorIn.addEventListener('input', () => {p.color=colorIn.value;renderMarkers();savePoints();});
      const presets = document.createElement('div');
      presets.className='color-presets';
      ['#486b5c','#1976d2','#d32f2f','#f9a825','#7b1fa2','#111111'].forEach(preset => {
        const presetBtn=document.createElement('button');
        presetBtn.type='button';
        presetBtn.className='color-preset';
        presetBtn.style.backgroundColor=preset;
        presetBtn.title=`Use ${preset}`;
        presetBtn.setAttribute('aria-label', `Use marker color ${preset}`);
        presetBtn.addEventListener('click', event => {
          event.stopPropagation();
          p.color=preset; colorIn.value=preset; renderMarkers(); savePoints();
        });
        presets.appendChild(presetBtn);
      });
      presets.appendChild(colorIn);
      color.appendChild(presets); tr.appendChild(color);

      const note = document.createElement('td');
      const noteIn = document.createElement('input'); noteIn.value=p.note;
      noteIn.addEventListener('change', () => {p.note=noteIn.value;renderMarkers();savePoints();});
      note.appendChild(noteIn); tr.appendChild(note);

      const act = document.createElement('td');
      const del = document.createElement('button'); del.textContent='Delete'; del.className='mini danger';
      del.addEventListener('click',()=>{points=points.filter(x=>x.id!==p.id);render();});
      act.appendChild(del); tr.appendChild(act);

      tr.addEventListener('click', event => {
        if (event.target.closest('input,button,select')) return;
        focusPosition(p);
      });
      tb.appendChild(tr);
    }
    renderMarkers();
    savePoints();
  }

  function focusPosition(p) {
    if (!p.visible) {
      p.visible=true;
      render();
    }
    map.flyTo([p.lat,p.lon], Math.max(map.getZoom(), 16), {duration:0.65});
    highlightLayer.clearLayers();
    const highlight=L.circleMarker([p.lat,p.lon], {
      radius:15,
      color:'#ffeb3b',
      weight:4,
      fillColor:p.color,
      fillOpacity:0.35,
      className:'position-highlight',
      interactive:false
    }).addTo(highlightLayer);
    setTimeout(() => highlightLayer.removeLayer(highlight), 2400);
  }

  function renderMarkers() {
    markerLayer.clearLayers();
    annotationLayer.clearLayers();
    points.filter(p => p.visible).forEach(p => {
      const m = L.circleMarker([p.lat,p.lon], {
        radius:6, color:'#ffffff', weight:2, fillColor:p.color, fillOpacity:1
      });
      const popup = `<b>${escapeHtml(p.name)}</b><br>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>${dmString(p.lat,true)}, ${dmString(p.lon,false)}${p.depth !== null ? '<br>Depth: '+p.depth+' m':''}${p.note ? '<br>'+escapeHtml(p.note):''}`;
      m.bindPopup(popup);
      markerLayer.addLayer(m);

      const labelAnchor = L.circleMarker([p.lat,p.lon], {
        radius:0,
        opacity:0,
        fillOpacity:0,
        interactive:false
      });
      labelAnchor.bindTooltip(p.name, {
        permanent:true,
        direction:'right',
        offset:[7,0],
        className:'marker-label'
      });
      annotationLayer.addLayer(labelAnchor);
    });
  }

  function fitMap() {
    const visiblePoints=points.filter(p=>p.visible);
    if (!visiblePoints.length) return;
    if (visiblePoints.length===1) map.setView([visiblePoints[0].lat,visiblePoints[0].lon], 14);
    else map.fitBounds(L.latLngBounds(visiblePoints.map(p=>[p.lat,p.lon])), {padding:[35,35],maxZoom:18});
  }
  el('fitBtn').addEventListener('click', fitMap);

  document.querySelectorAll('.sort-button').forEach(button => {
    button.addEventListener('click', () => {
      const key=button.dataset.sort;
      sortState = sortState.key === key
        ? {key, direction:sortState.direction * -1}
        : {key, direction:1};
      document.querySelectorAll('.sort-button').forEach(b => b.removeAttribute('data-direction'));
      button.dataset.direction=sortState.direction === 1 ? 'asc' : 'desc';
      render();
    });
  });

  el('selectAllBtn').addEventListener('click', () => {
    const showAll=points.some(p=>!p.visible);
    points.forEach(p=>{p.visible=showAll;});
    render();
  });

  function escapeHtml(s='') {
    return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function normalizeKey(k) { return String(k||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function first(row, candidates) {
    const keys=Object.keys(row);
    for(const c of candidates){
      const hit=keys.find(k=>normalizeKey(k)===normalizeKey(c));
      if(hit!==undefined && row[hit]!==undefined && row[hit]!=='') return row[hit];
    }
    return '';
  }

  function parseDMText(v, isLat) {
    if (typeof v === 'number') return v;
    const s=String(v||'').trim();
    if (!s) return NaN;
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
    const hemMatch=s.match(/[NSEW]/i);
    const hem=hemMatch ? hemMatch[0].toUpperCase() : null;
    const nums=s.match(/[-+]?\d+(?:\.\d+)?/g);
    if(!nums || !nums.length) return NaN;
    if(nums.length===1) return Number(nums[0]);
    let deg=Math.abs(Number(nums[0])), min=Number(nums[1]);
    let out=deg+min/60;
    if(hem==='S'||hem==='W'||Number(nums[0])<0) out*=-1;
    return out;
  }

  async function importFile(file) {
    if(!file) return;
    try{
      const data=await file.arrayBuffer();
      const wb=XLSX.read(data,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length){alert('No rows found in the first worksheet.');return;}

      let added=0, skipped=0;
      for(const row of rows){
        const name=first(row,['Name','Site','Label','Station','ID','Point']);
        const note=first(row,['Annotation','Note','Description','Comment','Comments']);
        let lat=first(row,['Latitude','Lat','LatitudeDD','LatDD']);
        let lon=first(row,['Longitude','Lon','Long','Lng','LongitudeDD','LonDD']);
        const depth=parseDepth(first(row,['Depth','Depthm','DepthMeters','WaterDepth','WaterDepthm']));

        lat=parseDMText(lat,true);
        lon=parseDMText(lon,false);

        if(validate(lat,lon) && !Number.isNaN(depth)){
          const color=String(first(row,['Color','MarkerColor']) || accent);
          const visibleValue=String(first(row,['Visible','Show','Selected']) || 'true').toLowerCase();
          addPosition({name:String(name||''),note:String(note||''),lat,lon,depth,color,visible:!['false','no','0','hidden'].includes(visibleValue)},false);
          added++;
        } else skipped++;
      }
      render(); fitMap();
      status.textContent=`Imported ${added} position${added===1?'':'s'}${skipped?`; skipped ${skipped} invalid row${skipped===1?'':'s'}`:''}.`;
    }catch(err){
      console.error(err);
      alert('Could not read that spreadsheet. Please use XLSX, XLS, CSV, or TSV.');
    }
  }

  el('fileInput').addEventListener('change', e=>importFile(e.target.files[0]));
  const dz=el('dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag');}));
  dz.addEventListener('drop',e=>importFile(e.dataTransfer.files[0]));

  el('clearAllBtn').addEventListener('click',()=>{
    if(points.length && confirm('Remove all positions?')){points=[];render();}
  });

  el('exportMapBtn').addEventListener('click', async () => {
    const button=el('exportMapBtn');
    const original=button.textContent;
    button.disabled=true;
    button.textContent='Rendering PNG…';
    try {
      const canvas=await html2canvas(el('map'), {
        useCORS:true,
        allowTaint:false,
        backgroundColor:'#d9e6e7',
        scale:Math.min(window.devicePixelRatio || 1, 2),
        logging:false
      });
      const blob=await new Promise((resolve,reject) => {
        canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('PNG encoding failed')),
          'image/png'
        );
      });
      const url=URL.createObjectURL(new Blob([blob], {type:'image/png'}));
      const a=document.createElement('a');
      a.download=`bathymetry-map-${new Date().toISOString().slice(0,10)}.png`;
      a.href=url;
      a.type='image/png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent='Map PNG exported as image/png.';
    } catch (err) {
      console.error(err);
      alert('The map image could not be exported. Try again after all map layers have finished loading.');
    } finally {
      button.disabled=false;
      button.textContent=original;
    }
  });

  el('exportBtn').addEventListener('click',()=>{
    const out=points.map(p=>({
      Name:p.name,
      Latitude_DD:p.lat,
      Longitude_DD:p.lon,
      Latitude_DM:dmString(p.lat,true),
      Longitude_DM:dmString(p.lon,false),
      Depth_m:p.depth === null ? '' : Math.round(p.depth),
      Visible:p.visible,
      Marker_Color:p.color,
      Annotation:p.note
    }));
    const ws=XLSX.utils.json_to_sheet(out);
    const csv=XLSX.utils.sheet_to_csv(ws);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='mapped_positions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const examplePoints = [
    {name:'MJ01E',lat:44.479722,lon:-125.152500,depth:1238,note:'Example'},
    {name:'MJ01F',lat:44.364722,lon:-124.963056,depth:617,note:'Example'},
    {name:'MJ01G',lat:44.690000,lon:-124.456944,depth:112,note:'Example'},
    {name:'MJ01C',lat:44.637323,lon:-124.305402,depth:80,note:'Example'}
  ];

  el('exampleBtn').addEventListener('click', () => {
    if (points.length && !confirm('Add example positions to the current project?')) return;
    examplePoints.forEach(p => addPosition(p, false));
    render();
    fitMap();
    status.textContent = 'Loaded example RCA positions.';
  });

  const appLayout=document.querySelector('.app');
  const splitter=el('splitter');
  const savedSplit=Number(localStorage.getItem(SPLIT_STORAGE_KEY));
  if (Number.isFinite(savedSplit) && savedSplit >= 25 && savedSplit <= 70) {
    appLayout.style.setProperty('--left-width', `${savedSplit}%`);
  }

  function setSplitFromClientX(clientX) {
    if (window.matchMedia('(max-width:850px)').matches) return;
    const rect=appLayout.getBoundingClientRect();
    const minLeft=Math.max(320, rect.width * 0.25);
    const maxLeft=Math.min(rect.width - 360, rect.width * 0.7);
    const left=Math.min(maxLeft, Math.max(minLeft, clientX-rect.left));
    const percent=(left/rect.width)*100;
    appLayout.style.setProperty('--left-width', `${percent}%`);
    splitter.setAttribute('aria-valuenow', String(Math.round(percent)));
    map.invalidateSize({pan:false});
  }

  splitter.addEventListener('pointerdown', event => {
    if (window.matchMedia('(max-width:850px)').matches) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add('dragging');
    document.body.classList.add('resizing-layout');
  });
  splitter.addEventListener('pointermove', event => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    setSplitFromClientX(event.clientX);
  });
  splitter.addEventListener('pointerup', event => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    splitter.releasePointerCapture(event.pointerId);
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing-layout');
    const percent=parseFloat(getComputedStyle(appLayout).getPropertyValue('--left-width'));
    if (Number.isFinite(percent)) localStorage.setItem(SPLIT_STORAGE_KEY, String(percent));
    map.invalidateSize({pan:false});
  });
  splitter.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key) ||
        window.matchMedia('(max-width:850px)').matches) return;
    event.preventDefault();
    const rect=appLayout.getBoundingClientRect();
    const current=parseFloat(getComputedStyle(appLayout).getPropertyValue('--left-width')) || 44;
    const next=current+(event.key === 'ArrowRight' ? 2 : -2);
    setSplitFromClientX(rect.left+(next/100)*rect.width);
    const stored=parseFloat(getComputedStyle(appLayout).getPropertyValue('--left-width'));
    if (Number.isFinite(stored)) localStorage.setItem(SPLIT_STORAGE_KEY, String(stored));
  });
  window.addEventListener('resize', () => map.invalidateSize({pan:false}));

  function contourMidpoint(feature) {
    const geometry=feature?.geometry;
    const lines=geometry?.type === 'MultiLineString' ? geometry.coordinates :
      geometry?.type === 'LineString' ? [geometry.coordinates] : [];
    const line=lines.reduce((best,current) => current.length > best.length ? current : best, []);
    if (!line.length) return null;
    const point=line[Math.floor(line.length/2)];
    return [point[1],point[0]];
  }

  async function updateContourLabels() {
    const requestId=++contourLabelRequest;
    contourLabelLayer.clearLayers();
    if (!map.hasLayer(contours) || map.getZoom() < 15) return;
    const bounds=map.getBounds();
    const geometry={
      xmin:bounds.getWest(), ymin:bounds.getSouth(),
      xmax:bounds.getEast(), ymax:bounds.getNorth(),
      spatialReference:{wkid:4326}
    };
    const params=new URLSearchParams({
      where:'1=1',
      geometry:JSON.stringify(geometry),
      geometryType:'esriGeometryEnvelope',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      outFields:'Contour',
      returnGeometry:'true',
      outSR:'4326',
      f:'geojson',
      resultRecordCount:'1000'
    });
    try {
      const response=await fetch(
        'https://coast.noaa.gov/arcgis/rest/services/OceanReports/BathymetricContours/MapServer/0/query?'+params
      );
      if (!response.ok) throw new Error(`NOAA contour query returned ${response.status}`);
      const data=await response.json();
      if (requestId !== contourLabelRequest || !map.hasLayer(contours)) return;
      const used=new Set();
      (data.features || []).forEach(feature => {
        const depth=Number(feature.properties?.Contour);
        const position=contourMidpoint(feature);
        const key=Number.isFinite(depth) ? depth : null;
        if (!position || key === null || used.has(key) || used.size >= 32) return;
        used.add(key);
        L.marker(position, {
          interactive:false,
          icon:L.divIcon({
            className:'contour-depth-label',
            html:`<span>${Math.abs(Math.round(depth))} m</span>`,
            iconSize:null
          })
        }).addTo(contourLabelLayer);
      });
      if (used.size && !map.hasLayer(contourLabelLayer)) contourLabelLayer.addTo(map);
    } catch (err) {
      console.warn('Could not add supplemental contour labels.', err);
    }
  }

  map.on('moveend zoomend', updateContourLabels);
  map.on('overlayadd overlayremove', event => {
    if (event.layer === contours) updateContourLabels();
  });

  const restoredCount = restorePoints();
  render();
  if (restoredCount) {
    fitMap();
    setSaveState(`${restoredCount} restored and saved`);
  }
})();
