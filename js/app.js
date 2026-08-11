(() => {
  const accent = '#486b5c';
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
    minZoom: 2
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
    attribution:'GEBCO Compilation Group — latest WMS'
  }).addTo(map);

  const status = document.getElementById('status');
  bathy.on('load', () => { status.textContent = 'GEBCO bathymetry loaded.'; });
  bathy.on('tileerror', () => { status.textContent = 'GEBCO bathymetry tile error — check internet access or WMS availability.'; });

  L.control.scale({imperial:false,metric:true}).addTo(map);

  let points = [];
  let markerLayer = L.layerGroup().addTo(map);

  const el = id => document.getElementById(id);
  const nameEl = el('name'), noteEl = el('note');
  const coordMode = el('coordMode'), displayMode = el('displayMode');
  const ddEntry = el('ddEntry'), dmEntry = el('dmEntry');

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
    document.body.classList.toggle('mode-dm', displayMode.value === 'dm');
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
      note: p.note || ''
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

    for (const p of points) {
      const tr = document.createElement('tr');

      const site = document.createElement('td');
      const siteIn = document.createElement('input');
      siteIn.value = p.name;
      siteIn.addEventListener('change', () => { p.name=siteIn.value; renderMarkers(); });
      site.appendChild(siteIn);
      tr.appendChild(site);

      const latDD = document.createElement('td');
      latDD.className='coords-dd';
      const latIn = document.createElement('input');
      latIn.type='number'; latIn.step='any'; latIn.value=p.lat.toFixed(7);
      latIn.addEventListener('change', () => {
        const v=Number(latIn.value); if(validate(v,p.lon)){p.lat=v;renderMarkers();} else {latIn.value=p.lat.toFixed(7);}
      });
      latDD.appendChild(latIn); tr.appendChild(latDD);

      const lonDD = document.createElement('td');
      lonDD.className='coords-dd';
      const lonIn = document.createElement('input');
      lonIn.type='number'; lonIn.step='any'; lonIn.value=p.lon.toFixed(7);
      lonIn.addEventListener('change', () => {
        const v=Number(lonIn.value); if(validate(p.lat,v)){p.lon=v;renderMarkers();} else {lonIn.value=p.lon.toFixed(7);}
      });
      lonDD.appendChild(lonIn); tr.appendChild(lonDD);

      const latDM = document.createElement('td'); latDM.className='coords-dm'; latDM.textContent=dmString(p.lat,true); tr.appendChild(latDM);
      const lonDM = document.createElement('td'); lonDM.className='coords-dm'; lonDM.textContent=dmString(p.lon,false); tr.appendChild(lonDM);

      const depth = document.createElement('td');
      const depthIn = document.createElement('input');
      depthIn.type='number'; depthIn.min='0'; depthIn.step='any'; depthIn.value=p.depth ?? '';
      depthIn.addEventListener('change', () => {
        const v=parseDepth(depthIn.value);
        if(!Number.isNaN(v)){p.depth=v;renderMarkers();} else {depthIn.value=p.depth ?? '';}
      });
      depth.appendChild(depthIn); tr.appendChild(depth);

      const note = document.createElement('td');
      const noteIn = document.createElement('input'); noteIn.value=p.note;
      noteIn.addEventListener('change', () => {p.note=noteIn.value;renderMarkers();});
      note.appendChild(noteIn); tr.appendChild(note);

      const act = document.createElement('td');
      const del = document.createElement('button'); del.textContent='Delete'; del.className='mini danger';
      del.addEventListener('click',()=>{points=points.filter(x=>x.id!==p.id);render();});
      act.appendChild(del); tr.appendChild(act);
      tb.appendChild(tr);
    }
    renderMarkers();
  }

  function renderMarkers() {
    markerLayer.clearLayers();
    points.forEach(p => {
      const m = L.circleMarker([p.lat,p.lon], {
        radius:6, color:'#ffffff', weight:2, fillColor:accent, fillOpacity:1
      });
      const popup = `<b>${escapeHtml(p.name)}</b><br>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>${dmString(p.lat,true)}, ${dmString(p.lon,false)}${p.depth !== null ? '<br>Depth: '+p.depth+' m':''}${p.note ? '<br>'+escapeHtml(p.note):''}`;
      m.bindPopup(popup);
      m.bindTooltip(p.name, {permanent:true,direction:'right',offset:[7,0],className:'marker-label'});
      markerLayer.addLayer(m);
    });
  }

  function fitMap() {
    if (!points.length) return;
    if (points.length===1) map.setView([points[0].lat,points[0].lon], 10);
    else map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])), {padding:[35,35],maxZoom:12});
  }
  el('fitBtn').addEventListener('click', fitMap);

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
          addPosition({name:String(name||''),note:String(note||''),lat,lon,depth},false);
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

  el('exportBtn').addEventListener('click',()=>{
    const out=points.map(p=>({
      Name:p.name,
      Latitude_DD:p.lat,
      Longitude_DD:p.lon,
      Latitude_DM:dmString(p.lat,true),
      Longitude_DM:dmString(p.lon,false),
      Depth_m:p.depth ?? '',
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

  render();
})();
