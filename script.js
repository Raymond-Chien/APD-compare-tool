let apdData = {
  left: { filename: '', blocks: new Map(), blocksMeta: new Map(), rawOrder: [], errors: [] },
  right: { filename: '', blocks: new Map(), blocksMeta: new Map(), rawOrder: [], errors: [] }
};

// Track tags merged during this session
let mergedTags = {
  left: new Set(),
  right: new Set()
};

// Track original values to allow undoing an overwrite
let originalBackups = {
  left: new Map(),
  right: new Map()
};

// Main Entry: Initialize Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('file-left').addEventListener('change', (e) => loadFile(e, 'left'));
    document.getElementById('file-right').addEventListener('change', (e) => loadFile(e, 'right'));
    
    // Bind Persistent Sync Scroll once
    initSyncScroll();
});

function handleSearch() {
  const query = document.getElementById('search-tag').value.trim();
  document.getElementById('clear-search-btn').style.display = query ? 'block' : 'none';
  compareFiles();
}

function clearSearch() {
  document.getElementById('search-tag').value = '';
  handleSearch();
}

async function loadFile(event, side) {
  const file = event.target.files[0];
  if (!file) return;

  const content = await file.text();
  apdData[side].filename = file.name;
  document.getElementById(`path-${side}`).textContent = file.name;
  
  mergedTags[side] = new Set();
  originalBackups[side] = new Map();
  
  parseAPD(content, side);
  renderPanel(side);
  showHealthReport(side);

  if (apdData.left.blocks.size > 0 && apdData.right.blocks.size > 0) {
    compareFiles();
  }
}

/**
 * APD Parsing Logic with Hierarchy Support
 */
function parseAPD(content, side) {
  const lines = content.split(/\r?\n/);
  const blocks = new Map();
  const blocksMeta = new Map();
  const rawOrder = [];
  const errors = [];
  
  const tagStack = [];

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();
    
    if (line.length > trimmed.length && !line.endsWith('\r') && !line.endsWith('\n')) {
        if (line.match(/[ \t]+$/)) {
            errors.push({
                type: 'SPACE',
                tag: tagStack.length > 0 ? tagStack[tagStack.length-1].name : 'Header/Global',
                line: lineNum,
                msg: `第 ${lineNum} 行結尾有隱藏空白。`
            });
        }
    }

    if (line.includes('ABC12345XYZ') || line.includes('ABCDE1234567890')) {
        errors.push({
            type: 'PLACEHOLDER',
            tag: tagStack.length > 0 ? tagStack[tagStack.length-1].name : 'Global',
            line: lineNum,
            msg: `偵測到預設佔位符 (Placeholder) 第 ${lineNum} 行。`
        });
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed !== '[END]') {
      const newTagName = trimmed;
      if (tagStack.length > 0) {
          tagStack[tagStack.length - 1].isContainer = true;
          tagStack[tagStack.length - 1].childCount = (tagStack[tagStack.length - 1].childCount || 0) + 1;
      }
      
      // FIXING LEVEL: Top tag is depth 1, child is depth 2
      const currentLevel = tagStack.length + 1;
      tagStack.push({ name: newTagName, content: [], startLine: lineNum, level: currentLevel, isContainer: false, childCount: 0 });
      rawOrder.push(newTagName);
    } else if (trimmed === '[END]') {
      if (tagStack.length > 0) {
        const finishedTag = tagStack.pop();
        blocks.set(finishedTag.name, finishedTag.content.join('\n'));
        blocksMeta.set(finishedTag.name, { isContainer: finishedTag.isContainer, level: finishedTag.level, childCount: finishedTag.childCount });
      } else {
        errors.push({ type: 'ORPHAN_END', tag: 'N/A', line: lineNum, msg: `第 ${lineNum} 行發現孤立的 [END]。` });
      }
    } else if (tagStack.length > 0) {
      tagStack[tagStack.length - 1].content.push(line);
    }
  });

  if (tagStack.length > 0) {
    tagStack.forEach(tag => {
        errors.push({ type: 'MISSING_END', tag: tag.name, line: tag.startLine, msg: `標籤 [${tag.name}] 尚未關閉。` });
        blocks.set(tag.name, tag.content.join('\n'));
        blocksMeta.set(tag.name, { isContainer: tag.isContainer, level: tag.level, childCount: tag.childCount });
    });
  }
  
  apdData[side].blocks = blocks;
  apdData[side].blocksMeta = blocksMeta;
  apdData[side].rawOrder = rawOrder;
  apdData[side].errors = errors;
}

function showHealthReport(side) {
    const errors = apdData[side].errors;
    if (errors.length === 0) return;
    let report = `📋 APD 檔案格式檢查報告 (${apdData[side].filename})\n----------------------------------------\n`;
    errors.slice(0, 10).forEach(err => { report += `• [${err.type}] ${err.msg}\n`; });
    if (errors.length > 10) report += `... 以及其他 ${errors.length - 10} 個錯誤。\n`;
    alert(report);
}

function compareFiles() {
  const leftBlocks = apdData.left.blocks;
  const rightBlocks = apdData.right.blocks;
  const searchQuery = (document.getElementById('search-tag').value || "").trim().toLowerCase();
  const allTags = Array.from(new Set([...apdData.left.rawOrder, ...apdData.right.rawOrder]));
  const filteredTags = searchQuery ? allTags.filter(tag => tag.toLowerCase().includes(searchQuery)) : allTags;
  const vLeft = document.getElementById('viewer-left');
  const vRight = document.getElementById('viewer-right');
  vLeft.innerHTML = ''; vRight.innerHTML = '';
  let diffCount = 0, missCount = 0, matchCount = 0;

  filteredTags.forEach(tag => {
    const contentL = leftBlocks.get(tag), contentR = rightBlocks.get(tag);
    let stateL = 'normal', stateR = 'normal';
    const normalize = (str) => { if (!str) return ""; return str.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter((line, i, arr) => line !== "" || i < arr.findLastIndex(l => l.trim() !== "")).join('\n').trim(); };
    const normL = normalize(contentL), normR = normalize(contentR);

    if (contentL === undefined) { stateL = 'empty'; stateR = 'diff-added'; missCount++; }
    else if (contentR === undefined) { stateR = 'empty'; stateL = 'diff-removed'; missCount++; }
    else if (normL !== normR) { stateL = 'diff-changed'; stateR = 'diff-changed'; diffCount++; }
    else { matchCount++; stateL = 'match-success'; stateR = 'match-success'; }

    if (mergedTags.left.has(tag)) stateL = 'merged-item';
    if (mergedTags.right.has(tag)) stateR = 'merged-item';

    vLeft.appendChild(createBlockEl(tag, contentL, stateL, 'left'));
    vRight.appendChild(createBlockEl(tag, contentR, stateR, 'right'));
  });

  const overlay = document.getElementById('summary-overlay'); overlay.style.display = 'flex';
  document.getElementById('count-diff').textContent = diffCount;
  document.getElementById('count-miss').textContent = missCount;
  document.getElementById('count-match').textContent = matchCount;
}

function createBlockEl(tag, content, state, side) {
  const wrapper = document.createElement('div');
  wrapper.className = `apd-block ${state}`;
  if (state === 'empty') wrapper.classList.add('empty-block');

  const meta = apdData[side].blocksMeta.get(tag) || { level: 1, isContainer: false, childCount: 0 };
  const depth = (meta.level !== undefined) ? meta.level : 1;
  
  // Visual Indentation for hierarchy
  if (depth > 1) { 
      wrapper.style.marginLeft = `${(depth - 1) * 24}px`; 
      wrapper.classList.add('child-block'); 
  }

  const hasErrors = apdData[side].errors.some(e => e.tag === tag);
  if (hasErrors) wrapper.classList.add('has-errors');
  if (meta.isContainer) { 
      wrapper.classList.add('master-block'); 
      wrapper.style.backgroundColor = 'rgba(255,255,255, 0.02)'; 
  }

  if (state === 'empty') {
    wrapper.innerHTML = `<span>(缺失項目: ${tag})</span>`;
    wrapper.onclick = () => copyBlock(tag, side === 'left' ? 'right' : 'left');
    return wrapper;
  }

  const header = document.createElement('div');
  header.className = 'block-header';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  
  const leftGroup = document.createElement('div');
  leftGroup.style.display = 'flex';
  leftGroup.style.alignItems = 'center';
  
  // Tree line icon for children
  if (depth > 1) {
      leftGroup.innerHTML = `<span style="color:#555; margin-right:4px;">└── </span>`;
  }
  leftGroup.innerHTML += `<span>${tag}</span>`;

  const rightGroup = document.createElement('div');
  rightGroup.style.display = 'flex';
  rightGroup.style.alignItems = 'center';
  rightGroup.style.gap = '6px';
  
  if (meta.isContainer) rightGroup.innerHTML += `<span class="status-badge master-badge">📦 容器 (${meta.childCount})</span>`;
  if (hasErrors) rightGroup.innerHTML += `<span class="status-badge" style="background:#d4a017; color:black;">⚠️ FORMAT</span>`;
  if (state === 'match-success') rightGroup.innerHTML += `<span class="status-badge badge-match">MATCH</span>`;
  if (state === 'diff-changed') rightGroup.innerHTML += `<span class="status-badge badge-diff">DIFF</span>`;
  if (state === 'diff-removed' || state === 'diff-added') rightGroup.innerHTML += `<span class="status-badge badge-miss">MISSING</span>`;
  if (state === 'merged-item') rightGroup.innerHTML += `<span class="status-badge badge-merged">MERGED</span>`;

  if (state === 'merged-item') {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn'; undoBtn.innerHTML = '❌ 取消';
    undoBtn.onclick = (e) => { e.stopPropagation(); undoMerge(tag, side); };
    rightGroup.appendChild(undoBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn'; copyBtn.innerHTML = side === 'left' ? '➡️' : '⬅️';
  copyBtn.onclick = (e) => { e.stopPropagation(); copyBlock(tag, side); };
  rightGroup.appendChild(copyBtn);

  header.appendChild(leftGroup);
  header.appendChild(rightGroup);

  const body = document.createElement('div');
  body.className = 'block-content'; body.contentEditable = "true";
  body.textContent = content;
  body.onblur = () => { apdData[side].blocks.set(tag, body.textContent); compareFiles(); };

  wrapper.appendChild(header); wrapper.appendChild(body);
  return wrapper;
}

function copyBlock(tag, fromSide) {
  const toSide = fromSide === 'left' ? 'right' : 'left';
  const newContent = apdData[fromSide].blocks.get(tag);
  const oldContent = apdData[toSide].blocks.get(tag);
  const normalize = (str) => (str || "").split(/\r?\n/).map(l => l.trim().toLowerCase()).join('\n').trim();
  
  if (apdData[toSide].blocks.has(tag)) {
    if (normalize(newContent) === normalize(oldContent)) { alert(`⚠️ 項目已一致。`); return; }
    else { if (!confirm(`確定要覆蓋項目「${tag}」？`)) return; if (!originalBackups[toSide].has(tag)) originalBackups[toSide].set(tag, oldContent); }
  }

  apdData[toSide].blocks.set(tag, newContent);
  mergedTags[toSide].add(tag);
  const fromMeta = apdData[fromSide].blocksMeta.get(tag);
  if (fromMeta) apdData[toSide].blocksMeta.set(tag, {...fromMeta});
  if (!apdData[toSide].rawOrder.includes(tag)) apdData[toSide].rawOrder.push(tag);
  compareFiles();

  setTimeout(() => {
    const panels = ['viewer-left', 'viewer-right'];
    panels.forEach(panelId => {
      const viewer = document.getElementById(panelId);
      const blocks = viewer.getElementsByClassName('apd-block');
      for (let block of blocks) {
          const firstSpan = block.querySelector('.block-header div span:last-of-type');
          if (firstSpan && (firstSpan.textContent === tag || block.innerText.includes(tag))) {
              block.scrollIntoView({ behavior: 'smooth', block: 'center' });
              block.classList.add('flash-highlight');
              setTimeout(() => block.classList.remove('flash-highlight'), 2000);
          }
      }
    });
  }, 100);
}

function undoMerge(tag, side) {
  if (originalBackups[side].has(tag)) { apdData[side].blocks.set(tag, originalBackups[side].get(tag)); originalBackups[side].delete(tag); }
  else { apdData[side].blocks.delete(tag); apdData[side].blocksMeta.delete(tag); apdData[side].rawOrder = apdData[side].rawOrder.filter(t => t !== tag); }
  mergedTags[side].delete(tag); compareFiles();
}

function undoAllMerges(side) {
  if (mergedTags[side].size === 0) return;
  if (!confirm(`還原該側所有變更嗎？`)) return;
  const tagsToUndo = Array.from(mergedTags[side]);
  tagsToUndo.forEach(tag => {
    if (originalBackups[side].has(tag)) apdData[side].blocks.set(tag, originalBackups[side].get(tag));
    else { apdData[side].blocks.delete(tag); apdData[side].blocksMeta.delete(tag); apdData[side].rawOrder = apdData[side].rawOrder.filter(t => t !== tag); }
  });
  mergedTags[side].clear(); originalBackups[side].clear(); compareFiles();
}

function renderPanel(side) {
  const viewer = document.getElementById(`viewer-${side}`);
  viewer.innerHTML = '';
  apdData[side].rawOrder.forEach(tag => { viewer.appendChild(createBlockEl(tag, apdData[side].blocks.get(tag), 'normal', side)); });
}

function initSyncScroll() {
  const vLeft = document.getElementById('viewer-left');
  const vRight = document.getElementById('viewer-right');
  const syncCheck = document.getElementById('sync-scroll-check');
  let isSyncing = false;
  const handleScroll = (source, target) => {
    if (!syncCheck.checked) return;
    if (isSyncing) return;
    isSyncing = true;
    target.scrollTop = source.scrollTop;
    setTimeout(() => { isSyncing = false; }, 0); 
  };
  vLeft.addEventListener('scroll', () => handleScroll(vLeft, vRight));
  vRight.addEventListener('scroll', () => handleScroll(vRight, vLeft));
}

function toggleSyncScroll() { console.log("Sync Scroll Checked"); }

function mergeAllMissing(direction) {
  const fromSide = (direction === 'toRight') ? 'left' : 'right', toSide = (direction === 'toRight') ? 'right' : 'left';
  const fromData = apdData[fromSide], toData = apdData[toSide];
  let addedCount = 0;
  fromData.blocks.forEach((content, tag) => {
    if (!toData.blocks.has(tag)) {
      toData.blocks.set(tag, content); mergedTags[toSide].add(tag);
      const m = fromData.blocksMeta.get(tag); if (m) toData.blocksMeta.set(tag, {...m});
      const sourceIndex = fromData.rawOrder.indexOf(tag);
      if (sourceIndex > 0) {
        const prevTag = fromData.rawOrder[sourceIndex - 1], targetIndex = toData.rawOrder.indexOf(prevTag);
        if (targetIndex !== -1) toData.rawOrder.splice(targetIndex + 1, 0, tag); else toData.rawOrder.push(tag);
      } else toData.rawOrder.unshift(tag);
      addedCount++;
    }
  });
  if (addedCount > 0) { alert(`已補齊 ${addedCount} 個項目。`); compareFiles(); }
}

async function saveFileAs(side) {
  const data = apdData[side]; if (!data.blocks.size) return;
  let output = ""; data.rawOrder.forEach(tag => { output += `${tag}\n${data.blocks.get(tag)}\n[END]\n\n`; });
  const defaultName = data.filename || `apd_output_${side}.txt`;
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: 'Text Files', accept: { 'text/plain': ['.txt'] }, }], });
      const writable = await handle.createWritable(); await writable.write(output); await writable.close();
      alert("儲存成功！"); return;
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = defaultName; a.click(); URL.revokeObjectURL(url);
}
