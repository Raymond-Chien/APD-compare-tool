let apdData = {
  left: { filename: '', blocks: new Map(), rawOrder: [] },
  right: { filename: '', blocks: new Map(), rawOrder: [] }
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

document.getElementById('file-left').addEventListener('change', (e) => loadFile(e, 'left'));
document.getElementById('file-right').addEventListener('change', (e) => loadFile(e, 'right'));

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
  
  // Clear session state
  mergedTags[side] = new Set();
  originalBackups[side] = new Map();
  
  parseAPD(content, side);
  renderPanel(side);
  
  // Auto-compare when both sides are loaded
  if (apdData.left.blocks.size > 0 && apdData.right.blocks.size > 0) {
    compareFiles();
  }
}

/**
 * APD Parsing Logic
 * Detects [TAG] ... [END] structure
 */
function parseAPD(content, side) {
  const lines = content.split(/\r?\n/);
  const blocks = new Map();
  const rawOrder = [];
  
  let currentTag = null;
  let currentContent = [];

  for (let line of lines) {
    const trimmed = line.trim();
    
    // Detect Tag Start: [SOMETHING] but not [END]
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed !== '[END]') {
      currentTag = trimmed;
      currentContent = [];
    } else if (trimmed === '[END]') {
      if (currentTag) {
        blocks.set(currentTag, currentContent.join('\n'));
        rawOrder.push(currentTag);
        currentTag = null;
      }
    } else if (currentTag) {
      currentContent.push(line); // Preserve whitespace of original line content
    }
  }
  
  apdData[side].blocks = blocks;
  apdData[side].rawOrder = rawOrder;
}

/**
 * Side-by-Side Comparison with Filter
 */
function compareFiles() {
  const leftBlocks = apdData.left.blocks;
  const rightBlocks = apdData.right.blocks;
  
  if (leftBlocks.size === 0 || rightBlocks.size === 0) return;

  const searchQuery = (document.getElementById('search-tag').value || "").trim().toLowerCase();

  // Union of all tags
  const allTags = Array.from(new Set([...apdData.left.rawOrder, ...apdData.right.rawOrder]));
  
  // Filter tags based on search query
  const filteredTags = searchQuery 
    ? allTags.filter(tag => tag.toLowerCase().includes(searchQuery))
    : allTags;

  // Reset viewers
  const vLeft = document.getElementById('viewer-left');
  const vRight = document.getElementById('viewer-right');
  vLeft.innerHTML = '';
  vRight.innerHTML = '';

  let diffCount = 0;
  let missCount = 0;
  let matchCount = 0;

  filteredTags.forEach(tag => {
    const contentL = leftBlocks.get(tag);
    const contentR = rightBlocks.get(tag);
    
    let stateL = 'normal';
    let stateR = 'normal';

    // Normalization for comparison: Trim line, remove trailing empty, and ignore Case
    const normalize = (str) => {
      if (!str) return "";
      return str.split(/\r?\n/)
                .map(line => line.trim().toLowerCase()) 
                .filter((line, i, arr) => line !== "" || i < arr.findLastIndex(l => l.trim() !== ""))
                .join('\n').trim();
    };

    const normL = normalize(contentL);
    const normR = normalize(contentR);

    if (contentL === undefined) {
      stateL = 'empty';
      stateR = 'diff-added'; // Right has it, Left doesn't
      missCount++;
    } else if (contentR === undefined) {
      stateR = 'empty';
      stateL = 'diff-removed'; // Left has it, Right doesn't
      missCount++;
    } else if (normL !== normR) {
      stateL = 'diff-changed';
      stateR = 'diff-changed';
      diffCount++;
    } else {
      matchCount++;
      stateL = 'match-success'; // Mark matches explicitly
      stateR = 'match-success';
    }

    // Apply "Merged" state override
    if (mergedTags.left.has(tag)) stateL = 'merged-item';
    if (mergedTags.right.has(tag)) stateR = 'merged-item';

    vLeft.appendChild(createBlockEl(tag, contentL, stateL, 'left'));
    vRight.appendChild(createBlockEl(tag, contentR, stateR, 'right'));
  });

  const overlay = document.getElementById('summary-overlay');
  overlay.style.display = 'flex';
  document.getElementById('count-diff').textContent = diffCount;
  document.getElementById('count-miss').textContent = missCount;
  document.getElementById('count-match').textContent = matchCount;
  
  syncScroll();
}

function createBlockEl(tag, content, state, side) {
  const wrapper = document.createElement('div');
  wrapper.className = `apd-block ${state}`;
  if (state === 'empty') wrapper.classList.add('empty-block');

  if (state === 'empty') {
    wrapper.innerHTML = `<span>(缺失項目: ${tag})</span>`;
    wrapper.onclick = () => copyBlock(tag, side === 'left' ? 'right' : 'left');
    return wrapper;
  }

  const header = document.createElement('div');
  header.className = 'block-header';
  
  let headerHTML = `<span>${tag}</span>`;
  if (state === 'match-success') headerHTML += `<span class="status-badge badge-match">MATCH</span>`;
  if (state === 'diff-changed') headerHTML += `<span class="status-badge badge-diff">DIFFERENT</span>`;
  if (state === 'diff-removed' || state === 'diff-added') headerHTML += `<span class="status-badge badge-miss">MISSING</span>`;
  if (state === 'merged-item') headerHTML += `<span class="status-badge badge-merged">NEW MERGED</span>`;
  
  header.innerHTML = headerHTML;
  
  // Undo/Cancel Button for Merged Items
  if (state === 'merged-item') {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-btn';
    undoBtn.innerHTML = '❌ 取消補齊';
    undoBtn.onclick = (e) => {
      e.stopPropagation();
      undoMerge(tag, side);
    };
    header.appendChild(undoBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.innerHTML = side === 'left' ? '➡️' : '⬅️';
  copyBtn.title = `複製此區塊到${side === 'left' ? '右側' : '左側'}`;
  copyBtn.onclick = (e) => {
    e.stopPropagation();
    copyBlock(tag, side);
  };
  header.appendChild(copyBtn);

  const body = document.createElement('div');
  body.className = 'block-content';
  body.contentEditable = "true";
  body.textContent = content;
  body.onblur = () => {
    apdData[side].blocks.set(tag, body.textContent);
    compareFiles();
  };

  wrapper.appendChild(header);
  wrapper.appendChild(body);
  return wrapper;
}

function copyBlock(tag, fromSide) {
  const toSide = fromSide === 'left' ? 'right' : 'left';
  const newContent = apdData[fromSide].blocks.get(tag);
  const oldContent = apdData[toSide].blocks.get(tag);
  
  // Normalization for comparison
  const normalize = (str) => (str || "").split(/\r?\n/).map(l => l.trim().toLowerCase()).join('\n').trim();
  
  if (apdData[toSide].blocks.has(tag)) {
    if (normalize(newContent) === normalize(oldContent)) {
      alert(`⚠️ 項目「${tag}」內容已完全一致，不須重複變更。`);
      return;
    } else {
      const confirmOverwrite = confirm(
        `📌 項目「${tag}」內容已存在且不相同：\n\n` +
        `【原始內容】:\n${oldContent.slice(0, 100)}${oldContent.length > 100 ? '...' : ''}\n\n` +
        `【覆蓋內容】:\n${newContent.slice(0, 100)}${newContent.length > 100 ? '...' : ''}\n\n` +
        `是否確定要執行覆蓋變更？`
      );
      if (!confirmOverwrite) return;
      
      // Save Original as Backup before overwriting
      if (!originalBackups[toSide].has(tag)) {
        originalBackups[toSide].set(tag, oldContent);
      }
    }
  }

  apdData[toSide].blocks.set(tag, newContent);
  mergedTags[toSide].add(tag); // Mark as merged

  // Maintain order if it's new
  if (!apdData[toSide].rawOrder.includes(tag)) {
    apdData[toSide].rawOrder.push(tag);
  }
  
  compareFiles();

  // Highlight and Scroll to the new block
  setTimeout(() => {
    const panels = ['viewer-left', 'viewer-right'];
    panels.forEach(panelId => {
      const viewer = document.getElementById(panelId);
      const blocks = viewer.getElementsByClassName('apd-block');
      for (let block of blocks) {
        if (block.querySelector('.block-header span').textContent === tag) {
          block.scrollIntoView({ behavior: 'smooth', block: 'center' });
          block.classList.add('flash-highlight');
          setTimeout(() => block.classList.remove('flash-highlight'), 2000);
        }
      }
    });
  }, 100);
}

function undoMerge(tag, side) {
  if (originalBackups[side].has(tag)) {
    // Restore the original content from backup
    apdData[side].blocks.set(tag, originalBackups[side].get(tag));
    originalBackups[side].delete(tag);
  } else {
    // If it was a truly new (missing) tag, remove it completely
    apdData[side].blocks.delete(tag);
    apdData[side].rawOrder = apdData[side].rawOrder.filter(t => t !== tag);
  }
  
  mergedTags[side].delete(tag);
  compareFiles();
}

/**
 * Undo All Merges for a specific side
 */
function undoAllMerges(side) {
  if (mergedTags[side].size === 0) {
    alert("目前沒有任何已補齊的項目可以取消。");
    return;
  }

  if (!confirm(`確定要取消該側所有 (${mergedTags[side].size} 項) 的變更並還原嗎？`)) return;

  const tagsToUndo = Array.from(mergedTags[side]);
  tagsToUndo.forEach(tag => {
    if (originalBackups[side].has(tag)) {
      apdData[side].blocks.set(tag, originalBackups[side].get(tag));
    } else {
      apdData[side].blocks.delete(tag);
      apdData[side].rawOrder = apdData[side].rawOrder.filter(t => t !== tag);
    }
  });

  mergedTags[side].clear();
  originalBackups[side].clear();
  compareFiles();
  alert("已成功還原所有變更。");
}

function renderPanel(side) {
  const viewer = document.getElementById(`viewer-${side}`);
  viewer.innerHTML = '';
  
  apdData[side].rawOrder.forEach(tag => {
    const content = apdData[side].blocks.get(tag);
    viewer.appendChild(createBlockEl(tag, content, 'normal', side));
  });
}

function syncScroll() {
  const vLeft = document.getElementById('viewer-left');
  const vRight = document.getElementById('viewer-right');
  const isSync = document.getElementById('sync-scroll-check').checked;
  
  if (!isSync) {
    vLeft.onscroll = null;
    vRight.onscroll = null;
    return;
  }

  // Improved immediate sync with lock to prevent recursion
  const handleScroll = (e) => {
    const source = e.target;
    const target = (source === vLeft) ? vRight : vLeft;
    
    if (source._syncing) {
        source._syncing = false;
        return;
    }
    
    target._syncing = true;
    target.scrollTop = source.scrollTop;
  };

  vLeft.onscroll = handleScroll;
  vRight.onscroll = handleScroll;
}

function toggleSyncScroll() {
  syncScroll();
}

/**
 * Merge All Missing Tags from one side to the other
 * @param {string} direction 'toRight' or 'toLeft'
 */
function mergeAllMissing(direction) {
  const fromSide = (direction === 'toRight') ? 'left' : 'right';
  const toSide = (direction === 'toRight') ? 'right' : 'left';
  
  const fromData = apdData[fromSide];
  const toData = apdData[toSide];
  
  let addedCount = 0;
  
  fromData.blocks.forEach((content, tag) => {
    if (!toData.blocks.has(tag)) {
      toData.blocks.set(tag, content);
      mergedTags[toSide].add(tag); // Mark as merged

      // Determine logical insertion point (after the previous tag from source)
      const sourceIndex = fromData.rawOrder.indexOf(tag);
      if (sourceIndex > 0) {
        const prevTag = fromData.rawOrder[sourceIndex - 1];
        const targetIndex = toData.rawOrder.indexOf(prevTag);
        if (targetIndex !== -1) {
          toData.rawOrder.splice(targetIndex + 1, 0, tag);
        } else {
          toData.rawOrder.push(tag);
        }
      } else {
        toData.rawOrder.unshift(tag);
      }
      addedCount++;
    }
  });

  if (addedCount > 0) {
    alert(`已完成補齊：成功將 ${addedCount} 個缺失項目移至${toSide === 'left' ? '左側' : '右側'}`);
    compareFiles();
  } else {
    alert("沒有發現缺失項目需要補齊。");
  }
}

/**
 * Save As functionality using Modern File System Access API if available
 */
async function saveFileAs(side) {
  const data = apdData[side];
  if (!data.blocks.size) return;

  let output = "";
  data.rawOrder.forEach(tag => {
    output += `${tag}\n${data.blocks.get(tag)}\n[END]\n\n`;
  });

  const defaultName = data.filename || `apd_output_${side}.txt`;

  // Try modern "Save As" picker
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{
          description: 'Text Files',
          accept: { 'text/plain': ['.txt'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(output);
      await writable.close();
      alert("檔案已成功儲存！");
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn("Save Picker failed, falling back to download", err);
    }
  }

  // Fallback to legacy download
  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
}
