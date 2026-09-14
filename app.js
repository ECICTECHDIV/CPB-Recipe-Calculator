/* ============================================================
 * app.js — CPB試染工具：邏輯（計算 / 畫面互動 / 存讀檔 / PWA 註冊）
 * 這個檔案依賴 data.js 先載入（用到 translations、baumeTable、
 * tropicalRegionNaOH、sodiumSilicateDataB/C、naohConcData、
 * silicateFreeRegularTableA 等常數）。
 * ============================================================ */

        let currentLang = 'zh';
        let loadedRecipeName = '';
        let resultPhotos = [];
        const RESULT_PHOTO_MAX_DIM = 800; // 最長邊壓縮到 800px 內，兼顧清晰度與檔案大小
        const RESULT_PHOTO_QUALITY = 0.6; // JPEG 壓縮品質
        function makeDefaultRecipeRows(n) {
            return Array.from({ length: n }, () => ({ name: '', value: '' }));
        }
        let pretreatmentRecipes = {
            demin: makeDefaultRecipeRows(5),
            bleach: makeDefaultRecipeRows(5),
            single: makeDefaultRecipeRows(5)
        };
        let washingStagesContinuous = [{ flow: '', temp: '' }];
        let washingStagesJet = [{ temp: '', time: '' }];
        
        
        async function shareToolUrl() {
            const url = window.location.href;
            const btn = document.getElementById('shareButton');
            const originalHTML = btn.innerHTML;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(url);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = url;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
                const copiedText = currentLang === 'zh' ? '已複製!' : 'Copied!';
                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span class="hidden sm:inline">${copiedText}</span>`;
                setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
            } catch (err) {
                console.error('Copy failed:', err);
                alert(currentLang === 'zh' ? '複製失敗,請手動複製網址列的網址' : 'Copy failed — please copy the URL from the address bar manually');
            }
        }

        function setLanguage(lang) {
            currentLang = lang;
            document.getElementById('langBtnZh').classList.toggle('active', lang === 'zh');
            document.getElementById('langBtnEn').classList.toggle('active', lang === 'en');
            updateLanguage();
        }
        
        function updateLanguage() {
            const t = translations[currentLang];
            
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (t[key]) {
                    el.textContent = t[key];
                }
            });
            
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                if (t[key]) {
                    el.placeholder = t[key];
                }
            });

            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                const key = el.getAttribute('data-i18n-title');
                if (t[key]) {
                    el.title = t[key];
                    el.setAttribute('aria-label', t[key]);
                }
            });

            if (loadedRecipeName) {
                document.getElementById('recipeNameInput').placeholder = currentLang === 'zh'
                    ? `目前載入:${loadedRecipeName}(留空即覆蓋)`
                    : `Loaded: ${loadedRecipeName} (blank = overwrite)`;
            }

            const savedRecipesSelect = document.getElementById('savedRecipesSel');
            const previousRecipeSelection = savedRecipesSelect ? savedRecipesSelect.value : '';
            updateRecipeList();
            if (savedRecipesSelect && previousRecipeSelection) {
                savedRecipesSelect.value = previousRecipeSelection;
            }

            calculate();

            const pretreatmentMethodVal = document.getElementById('pretreatmentMethod')?.value;
            if (pretreatmentMethodVal === 'continuous') {
                renderPretreatmentRecipeTable('demin');
                renderPretreatmentRecipeTable('bleach');
            } else if (pretreatmentMethodVal === 'cold-bleach' || pretreatmentMethodVal === 'jet') {
                renderPretreatmentRecipeTable('single');
            }
            const washingMethodVal = document.getElementById('washingMethod')?.value;
            if (washingMethodVal === 'continuous') renderWashingStages('continuous');
            else if (washingMethodVal === 'jet') renderWashingStages('jet');
        }
        
        const DYE_ALKALI_RATIO = 4;
        const MOTHER_LIQUOR_DYE_MULTIPLIER = (DYE_ALKALI_RATIO + 1) / DYE_ALKALI_RATIO;
        const MOTHER_LIQUOR_ALKALI_MULTIPLIER = DYE_ALKALI_RATIO + 1;
        const DEFAULT_DYE_BUFFER = 50;
        const DEFAULT_ALKALI_BUFFER = 50;

        let lastAlkaliRenderKey = null;
        const ALKALI_ACTUAL_INPUT_IDS = [
            'sodaAshActualA', 'naohActualA',
            'silicateActualB', 'naohActualB',
            'silicateActualC', 'naohActualC',
            'sodaAshActualD', 'naohActualD'
        ];

        function computeAlkaliRenderKey(method, totalDye) {
            const dyeKey = ':dye=' + (typeof totalDye === 'number' ? totalDye.toFixed(2) : '');
            if (method === 'silicate-free') {
                const t = document.getElementById('alkaliTypeA').value;
                return 'A:' + t + (t === 'custom' ? ':' + (document.getElementById('customBaumeA').value || '') : '') + dyeKey;
            } else if (method === 'sodium-silicate') {
                const sc = document.getElementById('silicateConc').value;
                const nc = document.getElementById('naohConcB').value;
                return 'B:' + sc + ':' + nc + (nc === 'custom' ? ':' + (document.getElementById('customBaumeB').value || '') : '') + dyeKey;
            } else if (method === 'modified-silicate') {
                const sc = document.getElementById('silicateConcC').value;
                const nc = document.getElementById('naohConcC').value;
                return 'C:' + sc + ':' + nc + (nc === 'custom' ? ':' + (document.getElementById('customBaumeC').value || '') : '') + dyeKey;
            } else if (method === 'tropical-region') {
                const nc = document.getElementById('naohConcD').value;
                return 'D:' + nc + (nc === 'custom' ? ':' + (document.getElementById('customBaumeD').value || '') : '') + dyeKey;
            }
            return method + dyeKey;
        }

        function capturePreservedAlkaliActuals(method, totalDye) {
            const renderKey = computeAlkaliRenderKey(method, totalDye);
            const preserved = {};
            if (renderKey === lastAlkaliRenderKey) {
                ALKALI_ACTUAL_INPUT_IDS.forEach(id => {
                    const el = document.getElementById(id);
                    if (el && el.value !== '') preserved[id] = el.value;
                });
            }
            lastAlkaliRenderKey = renderKey;
            return preserved;
        }
        
        function getSavedRecipes() {
            try {
                return JSON.parse(localStorage.getItem('cpbRecipes') || '{}');
            } catch (err) {
                console.error('Failed to read saved recipes:', err);
                alert(currentLang === 'zh'
                    ? '無法讀取已儲存的配方。此瀏覽器/模式可能限制了本機儲存功能(常見於 iOS 獨立模式的私密瀏覽限制),請改用一般的 Safari 分頁開啟試試。'
                    : 'Unable to read saved recipes. This browser/mode may be restricting local storage (common with iOS private browsing restrictions in standalone mode) — try opening this in a regular Safari tab instead.');
                return null;
            }
        }

        function setSavedRecipes(recipes) {
            try {
                localStorage.setItem('cpbRecipes', JSON.stringify(recipes));
                return true;
            } catch (err) {
                console.error('Failed to save recipes:', err);
                alert(currentLang === 'zh'
                    ? '儲存失敗:此瀏覽器/模式可能限制了本機儲存功能(常見於 iOS 獨立模式的私密瀏覽限制,或儲存空間已滿),請改用一般的 Safari 分頁開啟試試。'
                    : 'Save failed: this browser/mode may be restricting local storage (common with iOS private browsing restrictions in standalone mode, or storage is full) — try opening this in a regular Safari tab instead.');
                return false;
            }
        }

        const DRAFT_STORAGE_KEY = 'cpb_draft';

        function autoSaveDraft() {
            try {
                const data = collectRecipeData();
                data.resultPhotos = [];
                localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data));
            } catch (err) {
                console.error('Auto-save draft failed:', err);
            }
        }

        let autoSaveTimer = null;
        function scheduleAutoSave() {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(autoSaveDraft, 500);
        }

        function restoreDraftOnLoad() {
            try {
                const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                applyRecipeData(data);
            } catch (err) {
                console.error('Failed to restore draft:', err);
            }
        }

        function clearCurrentDraft() {
            const confirmMsg = currentLang === 'zh'
                ? '確定要清除目前畫面上尚未存檔的內容嗎?已經用名字儲存過的配方不會受影響,但目前正在填寫、還沒存檔的內容會被清空,無法復原。'
                : 'Clear everything currently on screen (not yet saved as a named recipe)? This cannot be undone.';
            if (!confirm(confirmMsg)) return;

            try {
                localStorage.removeItem(DRAFT_STORAGE_KEY);
            } catch (err) {
                console.error('Failed to clear draft:', err);
            }
            location.reload();
        }

        // iPhone 相機預設拍出來是 HEIC 格式，瀏覽器完全無法直接解碼（Android 的 JPEG 沒有這個問題）。
        // 用 heic2any 這個函式庫做轉檔，但它體積不小，所以不寫死在 <script src>，只在真的遇到
        // HEIC 檔案時才動態載入，Android 使用者完全不會載到這段東西。
        let heic2anyLoadPromise = null;
        function loadHeic2Any() {
            if (window.heic2any) return Promise.resolve();
            if (heic2anyLoadPromise) return heic2anyLoadPromise;
            heic2anyLoadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('heic2any load failed'));
                document.head.appendChild(script);
            });
            return heic2anyLoadPromise;
        }
        // file.type 在部分 iOS Safari 版本上對 HEIC 檔案會回傳空字串，所以副檔名也要一併檢查
        function isHeicFile(file) {
            const type = (file.type || '').toLowerCase();
            if (type === 'image/heic' || type === 'image/heif') return true;
            return /\.(heic|heif)$/i.test(file.name || '');
        }

        async function handleResultPhotoInput(event) {
            const files = Array.from(event.target.files || []);
            event.target.value = '';

            for (const file of files) {
                const heic = isHeicFile(file);
                if (!heic && file.type && !file.type.startsWith('image/')) continue;

                let workingFile = file;
                if (heic) {
                    try {
                        await loadHeic2Any();
                        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
                        workingFile = Array.isArray(converted) ? converted[0] : converted;
                    } catch (err) {
                        console.error('HEIC 轉檔失敗：', err);
                        alert(currentLang === 'zh'
                            ? '這張照片是 iPhone 的 HEIC 格式，轉檔失敗。請重試一次，或到 iPhone「設定 → 相機 → 格式」改成「最相容」。'
                            : "This photo is in iPhone's HEIC format and the conversion failed. Please try again, or switch your iPhone's Camera format to \"Most Compatible\" under Settings → Camera → Formats.");
                        continue;
                    }
                }

                await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            let { width, height } = img;
                            if (width > height && width > RESULT_PHOTO_MAX_DIM) {
                                height = Math.round(height * RESULT_PHOTO_MAX_DIM / width);
                                width = RESULT_PHOTO_MAX_DIM;
                            } else if (height > RESULT_PHOTO_MAX_DIM) {
                                width = Math.round(width * RESULT_PHOTO_MAX_DIM / height);
                                height = RESULT_PHOTO_MAX_DIM;
                            }
                            canvas.width = width;
                            canvas.height = height;
                            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                            resultPhotos.push({ src: canvas.toDataURL('image/jpeg', RESULT_PHOTO_QUALITY), caption: '' });
                            renderResultPhotosGrid();
                            resolve();
                        };
                        img.onerror = () => {
                            console.error('圖片解碼失敗：', workingFile && workingFile.name);
                            alert(currentLang === 'zh'
                                ? '這張照片無法讀取，請換一張照片或重新拍攝。'
                                : "This photo couldn't be read. Please try a different photo or take a new one.");
                            resolve();
                        };
                        img.src = e.target.result;
                    };
                    reader.onerror = () => {
                        console.error('檔案讀取失敗：', workingFile && workingFile.name);
                        resolve();
                    };
                    reader.readAsDataURL(workingFile);
                });
            }
        }

        function renderResultPhotosGrid() {
            const grid = document.getElementById('resultPhotosGrid');
            if (!grid) return;
            const t = translations[currentLang];
            grid.innerHTML = resultPhotos.map((photo, i) => `
                <div class="relative">
                    <img src="${photo.src}" onclick="openPhotoLightbox(${i})" class="w-full aspect-square object-cover rounded-lg border border-gray-200 mb-1 cursor-zoom-in">
                    <button type="button" onclick="deleteResultPhoto(${i})" class="print:hidden absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold shadow hover:bg-red-600">×</button>
                    <input type="text" value="${(photo.caption || '').replace(/"/g, '&quot;')}" placeholder="${t.photoCaptionPlaceholder}" oninput="updatePhotoCaption(${i}, this.value)" style="line-height:1.6;" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
                </div>
            `).join('');
            renderWorkOrderResult();
            updatePrintPageBreaks();
        }

        function openPhotoLightbox(index) {
            const photo = resultPhotos[index];
            if (!photo) return;
            document.getElementById('photoLightboxImg').src = photo.src;
            document.getElementById('photoLightbox').classList.remove('hidden');
        }
        function closePhotoLightbox() {
            document.getElementById('photoLightbox').classList.add('hidden');
        }

        function updatePhotoCaption(index, value) {
            if (resultPhotos[index]) resultPhotos[index].caption = value;
            renderWorkOrderResult();
        }

        function deleteResultPhoto(index) {
            resultPhotos.splice(index, 1);
            renderResultPhotosGrid();
            scheduleAutoSave();
        }

        function getNameOrPlaceholder(inputEl) {
            if (!inputEl) return '';
            return inputEl.value.trim() || inputEl.placeholder || '';
        }

        function collectRecipeData() {
            return {
                customerName: document.getElementById('customerName').value,
                colorOrder: document.getElementById('colorOrder').value,
                fabricType: document.getElementById('fabricType').value,
                batchTime: document.getElementById('batchTime').value,
                
                fabricQuantity: document.getElementById('fabricQuantity').value,
                fabricWeight: document.getElementById('fabricWeight').value,
                fabricLength: document.getElementById('fabricLength').value,
                pickUp: document.getElementById('pickUp').value,
                runningSpeed: document.getElementById('runningSpeed').value,
                
                dyeSolution: document.getElementById('dyeSolution').value,
                alkaliSolution: document.getElementById('alkaliSolution').value,
                
                dyeRecipes: Array.from(document.querySelectorAll('#dyeTableBody tr[data-row-type="dye"]')).map(tr => ({
                    name: getNameOrPlaceholder(tr.querySelector('input[type="text"]')),
                    value: tr.querySelector('.dye-recipe')?.value || ''
                })),
                
                auxRecipes: Array.from(document.querySelectorAll('#dyeTableBody tr[data-row-type="aux"]')).map(tr => ({
                    name: getNameOrPlaceholder(tr.querySelector('input[type="text"]')),
                    value: tr.querySelector('.aux-recipe')?.value || ''
                })),
                
                alkaliMethod: document.getElementById('alkaliMethod').value,
                alkaliTypeA: document.getElementById('alkaliTypeA').value,
                customBaumeA: document.getElementById('customBaumeA').value,
                silicateConc: document.getElementById('silicateConc').value,
                naohConcB: document.getElementById('naohConcB').value,
                customBaumeB: document.getElementById('customBaumeB').value,
                silicateConcC: document.getElementById('silicateConcC').value,
                naohConcC: document.getElementById('naohConcC').value,
                customBaumeC: document.getElementById('customBaumeC').value,
                naohConcD: document.getElementById('naohConcD').value,
                customBaumeD: document.getElementById('customBaumeD').value,

                alkaliActuals: Object.fromEntries(
                    ALKALI_ACTUAL_INPUT_IDS.map(id => [id, document.getElementById(id)?.value ?? null])
                ),

                resultPhotos: resultPhotos.slice(),
                dyeResultNotes: document.getElementById('dyeResultNotes')?.value || '',

                pretreatmentMethod: document.getElementById('pretreatmentMethod')?.value || '',
                pretreatmentRecipes: JSON.parse(JSON.stringify(pretreatmentRecipes)),
                pretreatmentDeminTemp: document.getElementById('pretreatmentDeminTemp')?.value || '',
                pretreatmentDeminTime: document.getElementById('pretreatmentDeminTime')?.value || '',
                pretreatmentBleachTemp: document.getElementById('pretreatmentBleachTemp')?.value || '',
                pretreatmentBleachTime: document.getElementById('pretreatmentBleachTime')?.value || '',
                pretreatmentSingleTemp: document.getElementById('pretreatmentSingleTemp')?.value || '',
                pretreatmentSingleTime: document.getElementById('pretreatmentSingleTime')?.value || '',
                washingMethod: document.getElementById('washingMethod')?.value || '',
                washingRunningSpeed: document.getElementById('washingRunningSpeed')?.value || '',
                washingStagesContinuous: JSON.parse(JSON.stringify(washingStagesContinuous)),
                washingStagesJet: JSON.parse(JSON.stringify(washingStagesJet))
            };
        }

        function saveRecipe() {
            const typedName = document.getElementById('recipeNameInput').value.trim();
            const recipeName = typedName || loadedRecipeName;
            if (!recipeName) {
                alert(currentLang === 'zh' ? '請輸入配方名稱' : 'Please enter a recipe name');
                return;
            }

            const existingRecipes = getSavedRecipes();
            if (existingRecipes === null) return;
            if (existingRecipes[recipeName]) {
                const confirmMsg = currentLang === 'zh'
                    ? `已存在同名配方「${recipeName}」,是否要覆蓋?`
                    : `A recipe named "${recipeName}" already exists. Overwrite it?`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }
            
            const recipeData = collectRecipeData();
            
            let recipes = getSavedRecipes();
            if (recipes === null) return;
            recipes[recipeName] = recipeData;
            if (!setSavedRecipes(recipes)) return;
            
            updateRecipeList();
            document.getElementById('savedRecipesSel').value = recipeName;
            
            loadedRecipeName = recipeName;
            const recipeNameInput = document.getElementById('recipeNameInput');
            recipeNameInput.value = '';
            recipeNameInput.placeholder = currentLang === 'zh'
                ? `目前載入:${recipeName}(留空即覆蓋)`
                : `Loaded: ${recipeName} (blank = overwrite)`;
            
            alert(currentLang === 'zh' ? '配方儲存成功!' : 'Recipe saved successfully!');
        }
        
        function applyRecipeData(recipeData) {
            document.getElementById('customerName').value = recipeData.customerName || '';
            document.getElementById('colorOrder').value = recipeData.colorOrder || [recipeData.colorName, recipeData.orderNo].filter(Boolean).join(' / ') || '';
            document.getElementById('fabricType').value = recipeData.fabricType || '';
            document.getElementById('batchTime').value = recipeData.batchTime || '20';
            document.getElementById('paddingEndTime').value = '';
            
            document.getElementById('fabricQuantity').value = recipeData.fabricQuantity || '';
            document.getElementById('fabricWeight').value = recipeData.fabricWeight || '';
            document.getElementById('fabricLength').value = recipeData.fabricLength || '';
            document.getElementById('pickUp').value = recipeData.pickUp || '';
            document.getElementById('runningSpeed').value = recipeData.runningSpeed || '';

            if (recipeData.fabricWeight && recipeData.fabricLength) {
                fabricFieldTouchOrder = ['fabricWeight', 'fabricLength'];
            } else if (recipeData.fabricQuantity && recipeData.fabricWeight) {
                fabricFieldTouchOrder = ['fabricQuantity', 'fabricWeight'];
            } else if (recipeData.fabricQuantity && recipeData.fabricLength) {
                fabricFieldTouchOrder = ['fabricQuantity', 'fabricLength'];
            } else {
                fabricFieldTouchOrder = [];
            }
            
            document.getElementById('dyeSolution').value = recipeData.dyeSolution || '';
            document.getElementById('dyeSolution').dataset.userModified = 'true';
            document.getElementById('alkaliSolution').value = recipeData.alkaliSolution || '';
            document.getElementById('alkaliSolution').dataset.userModified = 'true';
            
            rebuildRecipeRows('dye', recipeData.dyeRecipes);
            rebuildRecipeRows('aux', recipeData.auxRecipes);
            
            document.getElementById('alkaliMethod').value = recipeData.alkaliMethod || 'silicate-free';
            updateAlkaliMethod();
            document.getElementById('alkaliTypeA').value = recipeData.alkaliTypeA || '38';
            document.getElementById('customBaumeA').value = recipeData.customBaumeA || '';
            document.getElementById('silicateConc').value = recipeData.silicateConc || '48-50';
            document.getElementById('naohConcB').value = recipeData.naohConcB || '38';
            document.getElementById('customBaumeB').value = recipeData.customBaumeB || '';
            document.getElementById('silicateConcC').value = recipeData.silicateConcC || '48-50';
            document.getElementById('naohConcC').value = recipeData.naohConcC || '38';
            document.getElementById('customBaumeC').value = recipeData.customBaumeC || '';
            document.getElementById('naohConcD').value = recipeData.naohConcD || '50';
            document.getElementById('customBaumeD').value = recipeData.customBaumeD || '';
            
            handleAlkaliTypeChange('A');
            handleAlkaliTypeChange('B');
            handleAlkaliTypeChange('C');
            handleAlkaliTypeChange('D');
            
            calculate();

            if (recipeData.alkaliActuals) {
                ALKALI_ACTUAL_INPUT_IDS.forEach(id => {
                    const val = recipeData.alkaliActuals[id];
                    const el = document.getElementById(id);
                    if (el && val !== null && val !== undefined && val !== '') {
                        el.value = val;
                    }
                });
                lastAlkaliRenderKey = computeAlkaliRenderKey(document.getElementById('alkaliMethod').value);
                calculateAlkaliQuantities();
            }

            resultPhotos = Array.isArray(recipeData.resultPhotos)
                ? recipeData.resultPhotos.map(p => typeof p === 'string' ? { src: p, caption: '' } : { src: p.src, caption: p.caption || '' })
                : [];
            renderResultPhotosGrid();
            document.getElementById('dyeResultNotes').value = recipeData.dyeResultNotes || '';

            pretreatmentRecipes = recipeData.pretreatmentRecipes
                ? JSON.parse(JSON.stringify(recipeData.pretreatmentRecipes))
                : { demin: makeDefaultRecipeRows(5), bleach: makeDefaultRecipeRows(5), single: makeDefaultRecipeRows(5) };
            document.getElementById('pretreatmentMethod').value = recipeData.pretreatmentMethod || '';
            document.getElementById('pretreatmentDeminTemp').value = recipeData.pretreatmentDeminTemp || '';
            document.getElementById('pretreatmentDeminTime').value = recipeData.pretreatmentDeminTime || '';
            document.getElementById('pretreatmentBleachTemp').value = recipeData.pretreatmentBleachTemp || '';
            document.getElementById('pretreatmentBleachTime').value = recipeData.pretreatmentBleachTime || '';
            document.getElementById('pretreatmentSingleTemp').value = recipeData.pretreatmentSingleTemp || '';
            document.getElementById('pretreatmentSingleTime').value = recipeData.pretreatmentSingleTime || '';
            updatePretreatmentUI();

            washingStagesContinuous = Array.isArray(recipeData.washingStagesContinuous) && recipeData.washingStagesContinuous.length
                ? JSON.parse(JSON.stringify(recipeData.washingStagesContinuous))
                : [{ flow: '', temp: '' }];
            washingStagesJet = Array.isArray(recipeData.washingStagesJet) && recipeData.washingStagesJet.length
                ? JSON.parse(JSON.stringify(recipeData.washingStagesJet))
                : [{ temp: '', time: '' }];
            document.getElementById('washingMethod').value = recipeData.washingMethod || '';
            document.getElementById('washingRunningSpeed').value = recipeData.washingRunningSpeed || '';
            updateWashingUI();

            updateWorkOrder();
        }

        function loadRecipe() {
            const recipeName = document.getElementById('savedRecipesSel').value;
            if (!recipeName) return;
            
            const recipes = getSavedRecipes();
            if (recipes === null) return;
            const recipeData = recipes[recipeName];
            
            if (!recipeData) {
                alert(currentLang === 'zh' ? '未找到配方' : 'Recipe not found');
                return;
            }
            
            loadedRecipeName = recipeName;
            const recipeNameInput = document.getElementById('recipeNameInput');
            recipeNameInput.value = '';
            recipeNameInput.placeholder = currentLang === 'zh'
                ? `目前載入:${recipeName}(留空即覆蓋)`
                : `Loaded: ${recipeName} (blank = overwrite)`;

            applyRecipeData(recipeData);
            scheduleAutoSave();
            
            alert(currentLang === 'zh' ? '配方載入成功!' : 'Recipe loaded successfully!');
        }
        
        function deleteRecipe() {
            const recipeName = document.getElementById('savedRecipesSel').value;
            if (!recipeName) {
                alert(currentLang === 'zh' ? '請選擇要刪除的配方' : 'Please select a recipe to delete');
                return;
            }
            
            if (!confirm(currentLang === 'zh' ? `確定要刪除 "${recipeName}" 嗎?` : `Are you sure you want to delete "${recipeName}"?`)) {
                return;
            }
            
            let recipes = getSavedRecipes();
            if (recipes === null) return;
            delete recipes[recipeName];
            if (!setSavedRecipes(recipes)) return;
            
            updateRecipeList();
            alert(currentLang === 'zh' ? '配方刪除成功!' : 'Recipe deleted successfully!');
        }
        
        function updateRecipeList() {
            const recipes = getSavedRecipes() || {};
            const select = document.getElementById('savedRecipesSel');
            const t = translations[currentLang];
            
            select.innerHTML = `<option value="">${t.selectRecipe}</option>`;
            
            Object.keys(recipes).sort().forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
        }
        
        function formatNumber(num) {
            const rounded = Math.round(num * 100) / 100;
            const decimals = (rounded % 1 === 0) ? 1 : 2;
            return rounded.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        }

        function formatNumberPlain(num) {
            const rounded = Math.round(num * 100) / 100;
            if (rounded % 1 === 0) {
                return rounded.toFixed(1);
            }
            return rounded.toFixed(2);
        }
        

        function toggleTable() {
            const table = document.getElementById('naohTable');
            const icon = document.getElementById('tableIcon');
            table.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');
        }

        function toggleAlkaliBasisTable() {
            const table = document.getElementById('alkaliBasisTable');
            const icon = document.getElementById('alkaliBasisIcon');
            table.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');
        }

        function renderAlkaliBasisTable() {
            const container = document.getElementById('alkaliBasisTable');
            if (!container) return;
            const method = document.getElementById('alkaliMethod').value;
            const totalDye = parseFloat(document.getElementById('totalDyeConc')?.textContent) || 0;
            const zh = currentLang === 'zh';
            const th = (label) => `<th class="border px-2 py-1">${label}</th>`;
            let html = '';

            if (method === 'silicate-free') {
                const headers = zh
                    ? ['染料用量 (g/l)', '純鹼 (g/l)', '液鹼 50% (cc/l)', '液鹼 50% (g/l)', '片鹼 (g/l)']
                    : ['Dye (g/l)', 'Soda Ash (g/l)', 'NaOH 50% (cc/l)', 'NaOH 50% (g/l)', 'NaOH Flakes (g/l)'];
                let rows = '';
                let prevMax = 0;
                silicateFreeRegularTableA.forEach(row => {
                    const inRange = totalDye > 0 && totalDye > prevMax - 1e-9 && totalDye <= row.max + 1e-9;
                    const label = row.max === Infinity ? `≥${prevMax}` : (prevMax === 0 ? `≤${row.max}` : `${prevMax}~${row.max}`);
                    rows += `<tr class="${inRange ? 'bg-yellow-50 font-bold' : ''}">
                        <td class="border px-2 py-1 text-center">${label}</td>
                        <td class="border px-2 py-1 text-center">${row.sodaAsh}</td>
                        <td class="border px-2 py-1 text-center">${row.naoh50CcPerL}</td>
                        <td class="border px-2 py-1 text-center">${row.naoh50GPerL}</td>
                        <td class="border px-2 py-1 text-center">${row.naohFlakesGPerL}</td>
                    </tr>`;
                    prevMax = row.max;
                });
                html = `
                    <table class="w-full border-collapse text-xs sm:text-sm">
                        <thead><tr class="table-header">${headers.map(th).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                    <p class="text-xs text-gray-500 mt-2">${zh ? '參考來源: Everzol C, ED, CS & ERC 染料 · 非水玻璃法(常規)建議表' : 'Source: Everzol C, ED, CS & ERC dyes · Silicate-Free (Regular) recommendation chart'}</p>
                `;
            } else if (method === 'sodium-silicate' || method === 'modified-silicate') {
                const isB = method === 'sodium-silicate';
                const silicateConc = document.getElementById(isB ? 'silicateConc' : 'silicateConcC').value;
                const data = (isB ? sodiumSilicateDataB : sodiumSilicateDataC)[silicateConc];
                const headers = zh ? ['染料用量 (g/l)', '液鹼 38°Bé (ml/l)'] : ['Dye (g/l)', 'NaOH 38°Bé (ml/l)'];
                const keys = Object.keys(data.naoh).map(Number).sort((a, b) => a - b);
                let rows = '';
                let prevMax = 0;
                keys.forEach(k => {
                    const inRange = totalDye > 0 && totalDye > prevMax - 1e-9 && totalDye <= k + 1e-9;
                    const label = prevMax === 0 ? `≤${k}` : `${prevMax}~${k}`;
                    rows += `<tr class="${inRange ? 'bg-yellow-50 font-bold' : ''}">
                        <td class="border px-2 py-1 text-center">${label}</td>
                        <td class="border px-2 py-1 text-center">${data.naoh[k]}</td>
                    </tr>`;
                    prevMax = k;
                });
                html = `
                    <p class="text-xs sm:text-sm font-semibold text-gray-700 mb-2">${zh ? '水玻璃' : 'Sodium Silicate'} ${silicateConc}°Bé (${data.gl} g/l)</p>
                    <table class="w-full border-collapse text-xs sm:text-sm">
                        <thead><tr class="table-header">${headers.map(th).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            } else if (method === 'tropical-region') {
                const headers = zh ? ['染料用量 (g/l)', '純鹼 (g/l)', '液鹼 50% (cc/l)'] : ['Dye (g/l)', 'Soda Ash (g/l)', 'NaOH 50% (cc/l)'];
                let rows = '';
                tropicalRegionNaOH.ranges.forEach(r => {
                    const inRange = totalDye > 0 && totalDye >= r.min - 1e-9 && totalDye <= r.max + 1e-9;
                    const label = r.min === -Infinity ? `≤${r.max}` : (r.max === Infinity ? `≥${r.min}` : `${r.min}~${r.max}`);
                    rows += `<tr class="${inRange ? 'bg-yellow-50 font-bold' : ''}">
                        <td class="border px-2 py-1 text-center">${label}</td>
                        <td class="border px-2 py-1 text-center">20</td>
                        <td class="border px-2 py-1 text-center">${r.cc}</td>
                    </tr>`;
                });
                html = `
                    <table class="w-full border-collapse text-xs sm:text-sm">
                        <thead><tr class="table-header">${headers.map(th).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                `;
            }

            container.innerHTML = html;
        }

        function toggleDownloadMenu(evt) {
            evt.stopPropagation();
            document.getElementById('downloadMenu')?.classList.toggle('hidden');
        }
        function closeDownloadMenu() {
            document.getElementById('downloadMenu')?.classList.add('hidden');
        }
        document.addEventListener('click', (evt) => {
            const wrap = document.getElementById('downloadMenuWrap');
            if (wrap && !wrap.contains(evt.target)) closeDownloadMenu();
        });

        function printWorkOrder() {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isIOS) {
                const msg = currentLang === 'zh'
                    ? '接下來會開啟列印預覽畫面。iOS 沒有直接「存成 PDF」的按鈕,請在預覽縮圖上用兩指放大,左上角會出現分享圖示,點下去選「儲存至檔案」即可存成 PDF。'
                    : 'The print preview will open next. iOS has no direct "Save as PDF" button — pinch to zoom on the preview thumbnail, then tap the share icon in the top-left corner and choose "Save to Files" to get a PDF.';
                alert(msg);
            }
            window.print();
        }

        async function copyWorkOrderAsImage() {
            const button = document.getElementById('downloadToggleBtn');
            const originalText = button.innerHTML;
            
            button.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="ml-2">Processing...</span>';
            button.disabled = true;
            
            const tempDisplay = button.style.display;
            button.style.display = 'none';

            try {
                const workOrder = document.getElementById('workOrderSection');
                
                const originalWidth = workOrder.style.width;
                const originalMaxWidth = workOrder.style.maxWidth;
                const originalMinWidth = workOrder.style.minWidth;
                const originalBorder = workOrder.style.border;
                const originalPadding = workOrder.style.padding;
                
                workOrder.style.width = '794px'; 
                workOrder.style.maxWidth = '794px';
                workOrder.style.minWidth = '794px';
                workOrder.style.border = 'none'; 
                workOrder.style.padding = '1rem'; 
                
                const canvas = await html2canvas(workOrder, {
                    backgroundColor: '#ffffff',
                    scale: 3, 
                    logging: false,
                    useCORS: true,
                    width: 794, 
                    windowWidth: 794
                });
                
                workOrder.style.width = originalWidth;
                workOrder.style.maxWidth = originalMaxWidth;
                workOrder.style.minWidth = originalMinWidth;
                workOrder.style.border = originalBorder;
                workOrder.style.padding = originalPadding;
                
                button.style.display = tempDisplay;
                button.innerHTML = originalText;
                button.disabled = false;
                
                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        alert('Failed to generate image');
                        return;
                    }
                    
                    try {
                        await downloadImage(blob, button, originalText);
                        
                        setTimeout(() => {
                            button.innerHTML = originalText;
                            button.classList.remove('bg-green-600');
                            button.classList.add('bg-blue-600', 'hover:bg-blue-700');
                            button.disabled = false;
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to process image:', err);
                        button.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span class="ml-2">Failed</span>';
                        button.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                        button.classList.add('bg-red-600');
                        
                        setTimeout(() => {
                            button.innerHTML = originalText;
                            button.classList.remove('bg-red-600');
                            button.classList.add('bg-blue-600', 'hover:bg-blue-700');
                            button.disabled = false;
                        }, 2000);
                    }
                }, 'image/png');
                
            } catch (err) {
                console.error('Error generating image:', err);
                
                const workOrder = document.getElementById('workOrderSection');
                workOrder.style.width = '';
                workOrder.style.maxWidth = '';
                workOrder.style.border = '';
                
                button.style.display = tempDisplay;
                button.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span class="ml-2">Failed</span>';
                button.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                button.classList.add('bg-red-600');
                button.disabled = false;
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.classList.remove('bg-red-600');
                    button.classList.add('bg-blue-600', 'hover:bg-blue-700');
                }, 2000);
            }
        }

        async function downloadImage(blob, button, originalText) {
            const date = new Date();
            const timestamp = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}`;
            const filename = `CPB_WorkOrder_${timestamp}.png`;

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            const isStandalone = window.navigator.standalone === true
                || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

            if (isIOS && isStandalone) {
                const url = URL.createObjectURL(blob);
                const modal = document.getElementById('saveImageModal');
                const img = document.getElementById('saveImageModalImg');
                img.src = url;
                modal.classList.remove('hidden');
                modal.dataset.objectUrl = url; 
                button.innerHTML = originalText;
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            button.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg><span class="ml-2">Downloaded!</span>';
            button.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            button.classList.add('bg-green-600');
        }

        function closeSaveImageModal() {
            const modal = document.getElementById('saveImageModal');
            modal.classList.add('hidden');
            if (modal.dataset.objectUrl) {
                URL.revokeObjectURL(modal.dataset.objectUrl);
                delete modal.dataset.objectUrl;
            }
        }

        function handleAlkaliTypeChange(method) {
            const typeSelect = document.getElementById(method === 'A' ? 'alkaliTypeA' : (method === 'B' ? 'naohConcB' : (method === 'C' ? 'naohConcC' : 'naohConcD')));
            const customInput = document.getElementById('customInput' + method);
            
            if (typeSelect.value === 'custom') {
                customInput.classList.remove('hidden');
                updateCustomNaOH(method);
                return; 
            } else {
                customInput.classList.add('hidden');
            }
            calculate();
        }

        function updateCustomNaOH(method) {
            const rawValue = document.getElementById('customBaume' + method).value;
            const baume = parseInt(rawValue);
            const warningEl = document.getElementById('customWarning' + method);
            
            if (baume >= 1 && baume <= 50 && baumeTable[baume]) {
                const data = baumeTable[baume];
                document.getElementById('customRho' + method).textContent = data.rho;
                document.getElementById('customGl' + method).textContent = data.gl;
                document.getElementById('customPercent' + method).textContent = data.percent + '%';
                warningEl.classList.add('hidden');
                warningEl.textContent = '';
            } else {
                document.getElementById('customRho' + method).textContent = '-';
                document.getElementById('customGl' + method).textContent = '-';
                document.getElementById('customPercent' + method).textContent = '-';
                warningEl.classList.remove('hidden');
                warningEl.textContent = rawValue.trim() === ''
                    ? (currentLang === 'zh' ? '請輸入波美度,系統暫以 38°Bé 標準值計算' : 'Please enter a Baumé value — using 38°Bé standard for now')
                    : (currentLang === 'zh' ? '波美度需介於 1~50 之間,系統暫以 38°Bé 標準值計算' : 'Baumé must be between 1–50 — using 38°Bé standard for now');
            }
            
            calculate();
        }

        function getNaOHData(method) {
            const typeSelect = document.getElementById(method === 'A' ? 'alkaliTypeA' : (method === 'B' ? 'naohConcB' : (method === 'C' ? 'naohConcC' : 'naohConcD')));
            const type = typeSelect.value;
            
            if (type === 'custom') {
                const baume = parseInt(document.getElementById('customBaume' + method).value);
                if (baume >= 1 && baume <= 50 && baumeTable[baume]) {
                    const data = baumeTable[baume];
                    return { specWeight: data.rho, contentGl: data.gl };
                } else {
                    return { specWeight: 1.357, contentGl: 441.0 };
                }
            } else {
                return naohConcData[type];
            }
        }

        
        function getNaOHForTropicalRegion(dyeConc) {
            for (let range of tropicalRegionNaOH.ranges) {
                if (dyeConc >= range.min && dyeConc <= range.max) {
                    return range.cc;
                }
            }
            return 2.5; 
        }
        




        function getAlkaliTableRowA(dyeConc) {
            for (const row of silicateFreeRegularTableA) {
                if (dyeConc <= row.max) return row;
            }
            return silicateFreeRegularTableA[silicateFreeRegularTableA.length - 1];
        }

        function getAlkaliMobileLabels() {
            return currentLang === 'zh'
                ? { suggested: '建議配方', actual: '實際配方', qty: '用量 (g)' }
                : { suggested: 'Suggested', actual: 'Actual', qty: 'Quantity (g)' };
        }

        function getAlkaliRecommendationA(dyeConc) {
            const row = getAlkaliTableRowA(dyeConc);
            const naoh38 = row.naoh50CcPerL * naohConcData['50'].contentGl / naohConcData['38'].contentGl;

            return {
                sodaAsh: row.sodaAsh,
                naoh38: parseFloat(naoh38.toFixed(2)),
                naoh50: row.naoh50CcPerL,
                naoh50GPerL: row.naoh50GPerL,   
                naohFlakes: row.naohFlakesGPerL
            };
        }

        function getNaOHForSodiumSilicate(dyeConc, data) {
            const keys = Object.keys(data.naoh).map(Number).sort((a,b) => a-b);
            for (let i = 0; i < keys.length; i++) {
                if (dyeConc <= keys[i]) return data.naoh[keys[i]];
            }
            return data.naoh[keys[keys.length - 1]];
        }

        function getNaOHDisplayName() {
            return currentLang === 'zh' ? '液鹼' : 'NaOH';
        }

        function computeMethodASuggestion(totalDye) {
            const alkaliRec = getAlkaliRecommendationA(totalDye);
            const alkaliType = document.getElementById('alkaliTypeA').value;
            const naohData = getNaOHData('A');
            const sodaAshLabel = currentLang === 'zh' ? '純鹼' : 'Soda Ash';
            const sodaAshSuggested = alkaliRec.sodaAsh;
            let naohSuggested, naohUnit, naohLabel, naohInfo;

            if (alkaliType === 'custom') {
                const customBaume = parseInt(document.getElementById('customBaumeA').value) || 38;
                naohSuggested = (alkaliRec.naoh38 * 441.0 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${customBaume}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            } else if (alkaliType === 'flakes') {
                naohSuggested = alkaliRec.naohFlakes;
                naohUnit = 'g/l';
                naohLabel = currentLang === 'zh' ? '片鹼' : 'NaOH Flakes';
                naohInfo = '';
            } else {
                const specWeight = alkaliType === '38' ? 1.357 : 1.530;
                naohSuggested = (alkaliType === '38' ? alkaliRec.naoh38 : alkaliRec.naoh50).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${alkaliType}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${specWeight}</div>`;
            }

            return { alkaliType, naohData, sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit, naohInfo };
        }

        function computeMethodBSuggestion(totalDye) {
            const silicateConc = document.getElementById('silicateConc').value;
            const silicateData = sodiumSilicateDataB[silicateConc];
            const naohMl38 = getNaOHForSodiumSilicate(totalDye, silicateData);
            const naohConc = document.getElementById('naohConcB').value;
            const naohData = getNaOHData('B');
            const sodiumSilicateLabel = currentLang === 'zh' ? '水玻璃' : 'Sodium Silicate';
            const silicateSuggested = silicateData.gl;
            let naohSuggested, naohUnit, naohLabel, naohInfo;

            if (naohConc === 'custom') {
                const customBaume = parseInt(document.getElementById('customBaumeB').value) || 38;
                naohSuggested = (naohMl38 * 441.0 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${customBaume}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            } else if (naohConc === 'flakes') {
                naohSuggested = (naohMl38 * 441.0 / 1000).toFixed(1);
                naohUnit = 'g/l';
                naohLabel = currentLang === 'zh' ? '片鹼' : 'NaOH Flakes';
                naohInfo = '';
            } else {
                naohSuggested = (naohMl38 * 441.0 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${naohConc}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            }

            return { naohConc, naohData, silicateConc, sodiumSilicateLabel, silicateSuggested, naohLabel, naohSuggested, naohUnit, naohInfo };
        }

        function computeMethodCSuggestion(totalDye) {
            const silicateConc = document.getElementById('silicateConcC').value;
            const silicateData = sodiumSilicateDataC[silicateConc];
            const naohMl38 = getNaOHForSodiumSilicate(totalDye, silicateData);
            const naohConc = document.getElementById('naohConcC').value;
            const naohData = getNaOHData('C');
            const sodiumSilicateLabel = currentLang === 'zh' ? '水玻璃' : 'Sodium Silicate';
            const silicateSuggested = silicateData.gl;
            let naohSuggested, naohUnit, naohLabel, naohInfo;

            if (naohConc === 'custom') {
                const customBaume = parseInt(document.getElementById('customBaumeC').value) || 38;
                naohSuggested = (naohMl38 * 441.0 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${customBaume}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            } else if (naohConc === 'flakes') {
                naohSuggested = (naohMl38 * 441.0 / 1000).toFixed(1);
                naohUnit = 'g/l';
                naohLabel = currentLang === 'zh' ? '片鹼' : 'NaOH Flakes';
                naohInfo = '';
            } else {
                naohSuggested = (naohMl38 * 441.0 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${naohConc}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            }

            return { naohConc, naohData, silicateConc, sodiumSilicateLabel, silicateSuggested, naohLabel, naohSuggested, naohUnit, naohInfo };
        }

        function computeMethodDSuggestion(totalDye) {
            const naohCc50 = getNaOHForTropicalRegion(totalDye);
            const naohConc = document.getElementById('naohConcD').value;
            const naohData = getNaOHData('D');
            const sodaAshLabel = currentLang === 'zh' ? '純鹼' : 'Soda Ash';
            const sodaAshSuggested = 20;
            let naohSuggested, naohUnit, naohLabel, naohInfo;

            if (naohConc === 'custom') {
                const customBaume = parseInt(document.getElementById('customBaumeD').value) || 50;
                naohSuggested = (naohCc50 * 766.5 / naohData.contentGl).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} ${customBaume}°Bé`;
                naohInfo = `<div class="text-xs text-gray-500">ρ=${naohData.specWeight}</div>`;
            } else if (naohConc === 'flakes') {
                naohSuggested = (naohCc50 * naohConcData['50'].contentGl / 1000).toFixed(1);
                naohUnit = 'g/l';
                naohLabel = currentLang === 'zh' ? '片鹼' : 'NaOH Flakes';
                naohInfo = '';
            } else if (naohConc === '50') {
                naohSuggested = naohCc50.toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} 50°Bé`;
                naohInfo = '<div class="text-xs text-gray-500">ρ=1.530</div>';
            } else {
                naohSuggested = (naohCc50 * 766.5 / 441.0).toFixed(1);
                naohUnit = 'ml/l';
                naohLabel = `${getNaOHDisplayName()} 38°Bé`;
                naohInfo = '<div class="text-xs text-gray-500">ρ=1.357</div>';
            }

            return { naohConc, naohData, sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit, naohInfo };
        }

        let fabricFieldTouchOrder = [];

        function handleFabricFieldInput(fieldId) {
            fabricFieldTouchOrder = fabricFieldTouchOrder.filter(id => id !== fieldId);
            fabricFieldTouchOrder.push(fieldId);
            if (fabricFieldTouchOrder.length > 2) fabricFieldTouchOrder.shift();

            recalcFabricFields();
            calculate();
        }

        function recalcFabricFields() {
            if (fabricFieldTouchOrder.length < 2) return;

            const allFields = ['fabricQuantity', 'fabricWeight', 'fabricLength'];
            const known = fabricFieldTouchOrder.slice(-2);
            const target = allFields.find(f => !known.includes(f));
            if (!target) return;

            const qtyEl = document.getElementById('fabricQuantity');
            const weightEl = document.getElementById('fabricWeight');
            const lengthEl = document.getElementById('fabricLength');

            const qty = parseFloat(qtyEl.value) || 0;
            const weight = parseFloat(weightEl.value) || 0;
            const length = parseFloat(lengthEl.value) || 0;

            if (target === 'fabricQuantity') {
                qtyEl.value = (weight > 0 && length > 0) ? (weight * length / 1000).toFixed(2) : '';
            } else if (target === 'fabricWeight') {
                weightEl.value = (qty > 0 && length > 0) ? (qty * 1000 / length).toFixed(2) : '';
            } else if (target === 'fabricLength') {
                lengthEl.value = (qty > 0 && weight > 0) ? (qty * 1000 / weight).toFixed(2) : '';
            }
        }

        function updatePretreatmentUI() {
            const method = document.getElementById('pretreatmentMethod').value;
            document.getElementById('pretreatmentContinuousBlocks').classList.toggle('hidden', method !== 'continuous');
            document.getElementById('pretreatmentSingleBlock').classList.toggle('hidden', method !== 'cold-bleach' && method !== 'jet');
            if (method === 'continuous') {
                renderPretreatmentRecipeTable('demin');
                renderPretreatmentRecipeTable('bleach');
            } else if (method === 'cold-bleach' || method === 'jet') {
                renderPretreatmentRecipeTable('single');
            }
            updateWorkOrder();
        }

        function updateWashingUI() {
            const method = document.getElementById('washingMethod').value;
            document.getElementById('washingContinuousBlock').classList.toggle('hidden', method !== 'continuous');
            document.getElementById('washingJetBlock').classList.toggle('hidden', method !== 'jet');
            if (method === 'continuous') renderWashingStages('continuous');
            else if (method === 'jet') renderWashingStages('jet');
            updateWorkOrder();
        }

        const PRETREATMENT_TABLE_CONTAINER = { demin: 'pretreatmentDeminTableWrap', bleach: 'pretreatmentBleachTableWrap', single: 'pretreatmentSingleTableWrap' };

        function renderPretreatmentRecipeTable(key) {
            const container = document.getElementById(PRETREATMENT_TABLE_CONTAINER[key]);
            if (!container) return;
            const t = translations[currentLang];
            const rows = pretreatmentRecipes[key];
            let html = `<div class="overflow-x-auto -mx-3 sm:mx-0"><table class="w-full border-collapse"><thead><tr class="table-header">
                <th class="border border-gray-200 px-2 sm:px-3 py-2 text-left" style="width:60%;">${t.chemicalName}</th>
                <th class="border border-gray-200 px-2 sm:px-3 py-2 text-left">${t.dosageGL}</th>
            </tr></thead><tbody>`;
            rows.forEach((row, i) => {
                html += `<tr>
                    <td class="border border-gray-300 px-2 py-1.5"><input type="text" value="${(row.name || '').replace(/"/g, '&quot;')}" placeholder="${t.chemicalNamePlaceholder}${i + 1}" oninput="updatePretreatmentRecipeCell('${key}', ${i}, 'name', this.value)" class="w-full input-field"></td>
                    <td class="border border-gray-300 px-2 py-1.5"><input type="number" value="${row.value || ''}" min="0" oninput="updatePretreatmentRecipeCell('${key}', ${i}, 'value', this.value)" class="w-full input-field number-display"></td>
                </tr>`;
            });
            html += `</tbody></table></div>
            <div class="flex justify-center gap-2 mt-2">
                <button type="button" onclick="addPretreatmentRecipeRow('${key}')" class="add-row-btn">${t.addRowGeneric}</button>
                <button type="button" onclick="removePretreatmentRecipeRow('${key}')" class="del-row-btn">${t.removeRowGeneric}</button>
            </div>`;
            container.innerHTML = html;
        }

        function updatePretreatmentRecipeCell(key, index, field, value) {
            pretreatmentRecipes[key][index][field] = value;
            updateWorkOrder();
        }
        function addPretreatmentRecipeRow(key) {
            pretreatmentRecipes[key].push({ name: '', value: '' });
            renderPretreatmentRecipeTable(key);
            scheduleAutoSave();
        }
        function removePretreatmentRecipeRow(key) {
            if (pretreatmentRecipes[key].length > 1) pretreatmentRecipes[key].pop();
            renderPretreatmentRecipeTable(key);
            updateWorkOrder();
            scheduleAutoSave();
        }

        function renderWashingStages(type) {
            const t = translations[currentLang];
            const containerId = type === 'continuous' ? 'washingContinuousStagesWrap' : 'washingJetStagesWrap';
            const container = document.getElementById(containerId);
            if (!container) return;
            const arr = type === 'continuous' ? washingStagesContinuous : washingStagesJet;
            const fields = type === 'continuous' ? ['flow', 'temp'] : ['temp', 'time'];
            const labels = type === 'continuous' ? [t.waterFlow, t.temperature] : [t.temperature, t.processTime];
            let html = `<div class="overflow-x-auto -mx-3 sm:mx-0"><table class="w-full border-collapse"><thead><tr class="table-header">
                <th class="border border-gray-200 px-2 sm:px-3 py-2 text-left" style="width:20%;">${t.stage}</th>
                <th class="border border-gray-200 px-2 sm:px-3 py-2 text-left">${labels[0]}</th>
                <th class="border border-gray-200 px-2 sm:px-3 py-2 text-left">${labels[1]}</th>
            </tr></thead><tbody>`;
            arr.forEach((row, i) => {
                html += `<tr>
                    <td class="border border-gray-300 px-2 py-1.5 text-center font-semibold number-display">${i + 1}</td>
                    <td class="border border-gray-300 px-2 py-1.5"><input type="number" value="${row[fields[0]] || ''}" min="0" oninput="updateWashingStageCell('${type}', ${i}, '${fields[0]}', this.value)" class="w-full input-field number-display"></td>
                    <td class="border border-gray-300 px-2 py-1.5"><input type="number" value="${row[fields[1]] || ''}" min="0" oninput="updateWashingStageCell('${type}', ${i}, '${fields[1]}', this.value)" class="w-full input-field number-display"></td>
                </tr>`;
            });
            html += `</tbody></table></div>
            <div class="flex justify-center gap-2 mt-2">
                <button type="button" onclick="addWashingStage('${type}')" class="add-row-btn">${t.addRowGeneric}</button>
                <button type="button" onclick="removeWashingStage('${type}')" class="del-row-btn">${t.removeRowGeneric}</button>
            </div>`;
            container.innerHTML = html;
        }

        function updateWashingStageCell(type, index, field, value) {
            const arr = type === 'continuous' ? washingStagesContinuous : washingStagesJet;
            arr[index][field] = value;
            updateWorkOrder();
        }
        function addWashingStage(type) {
            const arr = type === 'continuous' ? washingStagesContinuous : washingStagesJet;
            arr.push(type === 'continuous' ? { flow: '', temp: '' } : { temp: '', time: '' });
            renderWashingStages(type);
            scheduleAutoSave();
        }
        function removeWashingStage(type) {
            const arr = type === 'continuous' ? washingStagesContinuous : washingStagesJet;
            if (arr.length > 1) arr.pop();
            renderWashingStages(type);
            updateWorkOrder();
            scheduleAutoSave();
        }

        function addRecipeRow(type, presetName, presetValue) {
            const tbody = document.getElementById('dyeTableBody');
            const anchor = document.getElementById(type === 'dye' ? 'addDyeRowTr' : 'addAuxRowTr');
            if (!tbody || !anchor) return null;
            const isDye = type === 'dye';
            const t = translations[currentLang];
            const namePlaceholder = isDye ? t.dyePlaceholder : t.auxPlaceholder;
            const inputClass = isDye ? 'dye-recipe' : 'aux-recipe';
            const quantityClass = isDye ? 'dye-quantity' : 'aux-quantity';
            const extraAttr = isDye ? 'max="150"' : 'step="0.1"';
            const nameVal = (presetName || '').replace(/"/g, '&quot;');
            const numVal = (presetValue !== undefined && presetValue !== null) ? presetValue : '';
            const listAttr = isDye ? 'list="dyeNameSuggestions"' : '';

            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50';
            tr.dataset.rowType = type;
            tr.innerHTML = `
                <td class="border border-gray-200 px-3 sm:px-4 py-2"><input type="text" value="${nameVal}" placeholder="${namePlaceholder}" ${listAttr} class="w-full px-2 py-1.5 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none"></td>
                <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50"><input type="number" value="${numVal}" placeholder="0" ${extraAttr} min="0" oninput="calculate()" class="${inputClass} w-full px-2 py-1.5 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none"></td>
                <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold number-display text-right ${quantityClass}">0.00</td>
            `;
            tbody.insertBefore(tr, anchor);
            return tr;
        }

        function addDyeRow() {
            addRecipeRow('dye');
            calculate();
            scheduleAutoSave();
        }

        function addAuxRow() {
            addRecipeRow('aux');
            calculate();
            scheduleAutoSave();
        }

        function deleteLastRow(type) {
            const rows = document.querySelectorAll(`#dyeTableBody tr[data-row-type="${type}"]`);
            if (rows.length <= 1) {
                alert(translations[currentLang].minRowWarning);
                return;
            }
            rows[rows.length - 1].remove();
            calculate();
            scheduleAutoSave();
        }

        function rebuildRecipeRows(type, items) {
            document.querySelectorAll(`#dyeTableBody tr[data-row-type="${type}"]`).forEach(tr => tr.remove());
            const list = (items && items.length > 0) ? items : [{ name: '', value: '' }];
            list.forEach(item => addRecipeRow(type, item.name, item.value));
        }

        function updateAlkaliMethod() {
            const method = document.getElementById('alkaliMethod').value;
            document.getElementById('methodASelect').classList.toggle('hidden', method !== 'silicate-free');
            document.getElementById('methodBSelect').classList.toggle('hidden', method !== 'sodium-silicate');
            document.getElementById('methodCSelect').classList.toggle('hidden', method !== 'modified-silicate');
            document.getElementById('methodDSelect').classList.toggle('hidden', method !== 'tropical-region');
            document.getElementById('naohTypeASlot').classList.toggle('hidden', method !== 'silicate-free');
            calculate();
        }
        
        function calculate() {
            // Fabric quantity:總布量/布重/長度三個欄位互相計算的結果已經在 recalcFabricFields() 處理好了,
            // 這裡直接讀總布量欄位的值即可,不用再分「直接輸入」或「計算」兩種模式
            const fabricQty = parseFloat(document.getElementById('fabricQuantity').value) || 0;

            const pickUp = parseFloat(document.getElementById('pickUp').value) || 0;
            const theoretical = fabricQty * pickUp / 100;
            document.getElementById('theoreticalSolution').textContent = formatNumber(theoretical) + ' ltr';

            // 預估軋染時間 = 長度 ÷ 車速,兩個都要有正數值才顯示,缺一個就代表使用者不需要這個功能
            const runningSpeed = parseFloat(document.getElementById('runningSpeed').value) || 0;
            const fabricLengthVal = parseFloat(document.getElementById('fabricLength').value) || 0;
            const estimatedTimeBox = document.getElementById('estimatedTimeBox');
            if (runningSpeed > 0 && fabricLengthVal > 0) {
                const totalMinutes = fabricLengthVal / runningSpeed;
                const hours = Math.floor(totalMinutes / 60);
                const minutes = Math.round(totalMinutes % 60);
                const timeText = currentLang === 'zh' ? `${hours} 小時 ${minutes} 分鐘` : `${hours}h ${minutes}min`;
                document.getElementById('estimatedRunTime').textContent = timeText;
                estimatedTimeBox.classList.remove('hidden');
            } else {
                estimatedTimeBox.classList.add('hidden');
            }

            // 布量、軋吸率兩個都要有實際填的正數值,才顯示後面的配方與計算內容;
            // 只要還有一個是空的/0,就先顯示提示卡片,不要讓使用者看到一整排 0.00 的困惑畫面
            const planSection = document.getElementById('planSection');
            const fabricInputPrompt = document.getElementById('fabricInputPrompt');
            const hasValidFabricInputs = fabricQty > 0 && pickUp > 0;
            if (planSection && fabricInputPrompt) {
                planSection.classList.toggle('hidden', !hasValidFabricInputs);
                fabricInputPrompt.classList.toggle('hidden', hasValidFabricInputs);
            }
            updateQuickNavAvailability(hasValidFabricInputs);
            if (!hasValidFabricInputs) {
                // 門檻還沒跨過,但上面「鹼劑方法設定」區塊本來就一直看得到、可以互動,
                // 所以這兩個跟方法/NaOH類型選擇有關的提示還是要照常更新,不能因為提早 return 就卡住
                updateCurrentMethodBanner();
                renderAlkaliBasisTable();
                return; // 布量/軋吸率還沒填好,後面的計算跟 DOM 更新都還沒有意義,先不繼續跑
            }

            // Calculate theoretical split using DYE_ALKALI_RATIO
            const theoreticalDye = theoretical * DYE_ALKALI_RATIO / (DYE_ALKALI_RATIO + 1);
            const theoreticalAlkali = theoretical * 1 / (DYE_ALKALI_RATIO + 1);
            
            // Display theoretical dye and alkali
            document.getElementById('theoreticalDyeSol').textContent = formatNumber(theoreticalDye) + ' ltr';
            document.getElementById('theoreticalAlkaliSol').textContent = formatNumber(theoreticalAlkali) + ' ltr';

            // Auto-update dye and alkali solutions based on theoretical values
            const dyeSolInput = document.getElementById('dyeSolution');
            const alkaliSolInput = document.getElementById('alkaliSolution');
            
            // Only auto-update if user hasn't manually changed the values
            if (!dyeSolInput.dataset.userModified) {
                dyeSolInput.value = (theoreticalDye + DEFAULT_DYE_BUFFER).toFixed(2);
            }
            if (!alkaliSolInput.dataset.userModified) {
                alkaliSolInput.value = (theoreticalAlkali + DEFAULT_ALKALI_BUFFER).toFixed(2);
            }

            const dyeSol = parseFloat(dyeSolInput.value) || 0;
            const alkaliSol = parseFloat(alkaliSolInput.value) || 0;
            
            // Show differences from theoretical
            const dyeDiff = dyeSol - theoreticalDye;
            const alkaliDiff = alkaliSol - theoreticalAlkali;
            
            const t = translations[currentLang];
            
            document.getElementById('dyeDifference').innerHTML = `
                <span class="font-semibold text-blue-800">${t.vsTheoretical}</span>
                <span class="text-sm font-bold ${dyeDiff >= 0 ? 'text-gray-600' : 'text-red-700'}">${dyeDiff >= 0 ? '+' : ''}${formatNumber(dyeDiff)} ltr</span>
            `;
            
            document.getElementById('alkaliDifference').innerHTML = `
                <span class="font-semibold text-green-800">${t.vsTheoretical}</span>
                <span class="text-sm font-bold ${alkaliDiff >= 0 ? 'text-gray-600' : 'text-red-700'}">${alkaliDiff >= 0 ? '+' : ''}${formatNumber(alkaliDiff)} ltr</span>
            `;
            
            // Total actual solution (removed from display but keep calculation)
            const totalActual = dyeSol + alkaliSol;
            
            document.getElementById('dyeSolutionLabel').textContent = formatNumber(dyeSol);
            document.getElementById('alkaliSolutionLabel').textContent = formatNumber(alkaliSol);

            // Dyes - use mother liquor concentration
            const dyeRecipes = document.querySelectorAll('.dye-recipe');
            const dyeQuantities = document.querySelectorAll('.dye-quantity');
            let totalDye = 0;
            dyeRecipes.forEach((input, i) => {
                const recipe = parseFloat(input.value) || 0;
                totalDye += recipe;
                const motherLiquorConc = recipe * MOTHER_LIQUOR_DYE_MULTIPLIER;
                dyeQuantities[i].textContent = formatNumber(motherLiquorConc * dyeSol);
            });
            document.getElementById('totalDyeConc').textContent = formatNumberPlain(totalDye);
            // 「基於染料」四個方法共用同一個顯示位置,不管選哪個方法都要更新(原本各方法各自更新,搬移後統一放這裡)
            document.getElementById('dyeConcCurrent').textContent = formatNumberPlain(totalDye);

            // Auxiliaries - use mother liquor concentration
            const auxRecipes = document.querySelectorAll('.aux-recipe');
            const auxQuantities = document.querySelectorAll('.aux-quantity');
            auxRecipes.forEach((input, i) => {
                const recipe = parseFloat(input.value) || 0;
                const motherLiquorConc = recipe * MOTHER_LIQUOR_DYE_MULTIPLIER;
                auxQuantities[i].textContent = formatNumber(motherLiquorConc * dyeSol);
            });

            // Alkali calculation based on method
            const method = document.getElementById('alkaliMethod').value;
            const tbody = document.getElementById('alkaliTableBody');

            // 染料還沒填(總濃度為 0)時不顯示鹼劑建議表,避免讓人誤以為那是算好的真實建議
            const alkaliTableWrapper = document.getElementById('alkaliTableWrapper');
            const dyeInputPrompt = document.getElementById('dyeInputPrompt');
            const hasDyeInput = totalDye > 0;
            if (alkaliTableWrapper && dyeInputPrompt) {
                alkaliTableWrapper.classList.toggle('hidden', !hasDyeInput);
                dyeInputPrompt.classList.toggle('hidden', hasDyeInput);
            }
            if (!hasDyeInput) {
                tbody.innerHTML = '';
                lastAlkaliRenderKey = null; // 之後真的填了染料,要當成結構性變化重新給建議值,不要誤判成「延續舊值」
                updateWorkOrder();
                return;
            }

            // 在清空 DOM 前,先保留使用者已輸入的「實際配方」(若結構未變)
            const preservedActuals = capturePreservedAlkaliActuals(method, totalDye);
            tbody.innerHTML = '';

            if (method === 'silicate-free') {
    // Method A
    const { alkaliType, sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit, naohInfo } = computeMethodASuggestion(totalDye);

    // Build table with suggested and actual columns
    // 若使用者先前已手動修改過實際值(且方法/類型未變),沿用該值,不用系統建議值覆蓋
    const sodaAshActualValA = preservedActuals.sodaAshActualA !== undefined ? preservedActuals.sodaAshActualA : sodaAshSuggested;
    const naohActualValA = preservedActuals.naohActualA !== undefined ? preservedActuals.naohActualA : naohSuggested;
    const mLabelsA = getAlkaliMobileLabels();
    const tbody = document.getElementById('alkaliTableBody');
    tbody.innerHTML = `
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2 text-sm">${sodaAshLabel}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsA.suggested}">${sodaAshSuggested} g/l</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsA.actual}">
                <input type="number" id="sodaAshActualA" value="${sodaAshActualValA}" step="0.1" min="0" data-suggested="${sodaAshSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="sodaAshQtyA" data-label="${mLabelsA.qty}">-</td>
        </tr>
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2">
                <div class="text-sm font-medium">${naohLabel}</div>
                ${naohInfo}
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsA.suggested}">${naohSuggested} ${naohUnit}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsA.actual}">
                <input type="number" id="naohActualA" value="${naohActualValA}" step="0.1" min="0" data-suggested="${naohSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="naohQtyA" data-label="${mLabelsA.qty}">-</td>
        </tr>
    `;
    
    // Calculate quantities based on actual values
    calculateAlkaliQuantities();
            } else if (method === 'sodium-silicate') {
    // Method B
    const { silicateConc, sodiumSilicateLabel, silicateSuggested, naohLabel, naohSuggested, naohUnit, naohInfo } = computeMethodBSuggestion(totalDye);

    const silicateActualValB = preservedActuals.silicateActualB !== undefined ? preservedActuals.silicateActualB : silicateSuggested;
    const naohActualValB = preservedActuals.naohActualB !== undefined ? preservedActuals.naohActualB : naohSuggested;
    const mLabelsB = getAlkaliMobileLabels();
    const tbody = document.getElementById('alkaliTableBody');
    tbody.innerHTML = `
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2 text-sm font-medium">${sodiumSilicateLabel} ${silicateConc}°Bé</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsB.suggested}">${silicateSuggested} g/l</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsB.actual}">
                <input type="number" id="silicateActualB" value="${silicateActualValB}" step="0.1" min="0" data-suggested="${silicateSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="silicateQtyB" data-label="${mLabelsB.qty}">-</td>
        </tr>
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2">
                <div class="text-sm font-medium">${naohLabel}</div>
                ${naohInfo}
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsB.suggested}">${naohSuggested} ${naohUnit}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsB.actual}">
                <input type="number" id="naohActualB" value="${naohActualValB}" step="0.1" min="0" data-suggested="${naohSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="naohQtyB" data-label="${mLabelsB.qty}">-</td>
        </tr>
    `;
    
    calculateAlkaliQuantities();
            } else if (method === 'modified-silicate') {
    // Method C
    const { silicateConc, sodiumSilicateLabel, silicateSuggested, naohLabel, naohSuggested, naohUnit, naohInfo } = computeMethodCSuggestion(totalDye);

    const silicateActualValC = preservedActuals.silicateActualC !== undefined ? preservedActuals.silicateActualC : silicateSuggested;
    const naohActualValC = preservedActuals.naohActualC !== undefined ? preservedActuals.naohActualC : naohSuggested;
    const mLabelsC = getAlkaliMobileLabels();
    const tbody = document.getElementById('alkaliTableBody');
    tbody.innerHTML = `
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2 text-sm font-medium">${sodiumSilicateLabel} ${silicateConc}°Bé</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsC.suggested}">${silicateSuggested} g/l</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsC.actual}">
                <input type="number" id="silicateActualC" value="${silicateActualValC}" step="0.1" min="0" data-suggested="${silicateSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="silicateQtyC" data-label="${mLabelsC.qty}">-</td>
        </tr>
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2">
                <div class="text-sm font-medium">${naohLabel}</div>
                ${naohInfo}
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsC.suggested}">${naohSuggested} ${naohUnit}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsC.actual}">
                <input type="number" id="naohActualC" value="${naohActualValC}" step="0.1" min="0" data-suggested="${naohSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="naohQtyC" data-label="${mLabelsC.qty}">-</td>
        </tr>
    `;
    
    calculateAlkaliQuantities();
            } else if (method === 'tropical-region') {
    // Method D - Tropical Region
    const { sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit, naohInfo } = computeMethodDSuggestion(totalDye);

    const sodaAshActualValD = preservedActuals.sodaAshActualD !== undefined ? preservedActuals.sodaAshActualD : sodaAshSuggested;
    const naohActualValD = preservedActuals.naohActualD !== undefined ? preservedActuals.naohActualD : naohSuggested;
    const mLabelsD = getAlkaliMobileLabels();
    const tbody = document.getElementById('alkaliTableBody');
    tbody.innerHTML = `
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2 text-sm">${sodaAshLabel}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsD.suggested}">${sodaAshSuggested} g/l</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsD.actual}">
                <input type="number" id="sodaAshActualD" value="${sodaAshActualValD}" step="0.1" min="0" data-suggested="${sodaAshSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="sodaAshQtyD" data-label="${mLabelsD.qty}">-</td>
        </tr>
        <tr class="hover:bg-gray-50">
            <td class="border border-gray-200 px-3 sm:px-4 py-2">
                <div class="text-sm font-medium">${naohLabel}</div>
                ${naohInfo}
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-blue-50 text-sm" data-label="${mLabelsD.suggested}">${naohSuggested} ${naohUnit}</td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-amber-50" data-label="${mLabelsD.actual}">
                <input type="number" id="naohActualD" value="${naohActualValD}" step="0.1" min="0" data-suggested="${naohSuggested}"
                    oninput="calculateAlkaliQuantities()" 
                    class="w-full px-2 py-1 text-sm font-medium border border-gray-300 rounded focus:border-blue-500 focus:outline-none">
            </td>
            <td class="border border-gray-200 px-3 sm:px-4 py-2 bg-emerald-50 font-semibold text-sm number-display text-right" id="naohQtyD" data-label="${mLabelsD.qty}">-</td>
        </tr>
    `;
    
    calculateAlkaliQuantities();
            }
            
            // Update work order after calculation
            updateWorkOrder();
}

    // 「實際配方」偏離「建議配方」過多時的視覺警示(不影響計算結果,只是提醒複核)
    const ALKALI_DEVIATION_WARN_THRESHOLD = 0.2; // ±20%
    function applyActualDeviationStyle(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const suggested = parseFloat(el.dataset.suggested);
        const actual = parseFloat(el.value);
        el.classList.remove('border-red-500', 'bg-red-50', 'border-gray-300');
        el.title = '';
        if (!isNaN(suggested) && suggested > 0 && !isNaN(actual)) {
            const pctDiff = Math.abs(actual - suggested) / suggested;
            if (pctDiff > ALKALI_DEVIATION_WARN_THRESHOLD) {
                el.classList.add('border-red-500', 'bg-red-50');
                const pctText = (pctDiff * 100).toFixed(0) + '%';
                el.title = currentLang === 'zh'
                    ? `實際值與建議值相差 ${pctText},請複核`
                    : `Actual value differs from suggestion by ${pctText} — please double-check`;
                return;
            }
        }
        el.classList.add('border-gray-300');
    }

    // Calculate alkali quantities based on actual values
    function calculateAlkaliQuantities() {
        // 防呆:如果鹼劑表格還沒被建出來(例如染料濃度還是 0、表格處於「請先填染料」的提示狀態),
        // 表格裡的 sodaAshQtyA 之類元素根本不存在,下面直接對它們賦值會整個報錯崩掉。
        // 這裡先檢查表格本體有沒有內容,沒有就直接跳出,不要硬算。
        const alkaliTbody = document.getElementById('alkaliTableBody');
        if (!alkaliTbody || alkaliTbody.children.length === 0) return;

        const method = document.getElementById('alkaliMethod').value;
        const alkaliSol = parseFloat(document.getElementById('alkaliSolution').value) || 0;
        const alkaliType = method === 'silicate-free' ? document.getElementById('alkaliTypeA').value :
                          (method === 'sodium-silicate' ? document.getElementById('naohConcB').value :
                          (method === 'modified-silicate' ? document.getElementById('naohConcC').value :
                          document.getElementById('naohConcD').value));
        
        if (method === 'silicate-free') {
            // Method A
            const sodaAshActual = parseFloat(document.getElementById('sodaAshActualA')?.value) || 0;
            const naohActual = parseFloat(document.getElementById('naohActualA')?.value) || 0;
            applyActualDeviationStyle('sodaAshActualA');
            applyActualDeviationStyle('naohActualA');
            
            const sodaAshQty = sodaAshActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
            document.getElementById('sodaAshQtyA').textContent = formatNumber(sodaAshQty);
            
            if (alkaliType === 'flakes') {
                const naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyA').textContent = formatNumber(naohQty);
            } else {
                const naohData = getNaOHData('A');
                const naohWeight = naohActual * naohData.specWeight;
                const naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyA').textContent = formatNumber(naohQty);
            }
            
        } else if (method === 'sodium-silicate') {
            // Method B
            const silicateActual = parseFloat(document.getElementById('silicateActualB')?.value) || 0;
            const naohActual = parseFloat(document.getElementById('naohActualB')?.value) || 0;
            applyActualDeviationStyle('silicateActualB');
            applyActualDeviationStyle('naohActualB');
            
            const silicateQty = silicateActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
            document.getElementById('silicateQtyB').textContent = formatNumber(silicateQty);
            
            if (alkaliType === 'flakes') {
                const naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyB').textContent = formatNumber(naohQty);
            } else {
                const naohData = getNaOHData('B');
                const naohWeight = naohActual * naohData.specWeight;
                const naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyB').textContent = formatNumber(naohQty);
            }
            
        } else if (method === 'modified-silicate') {
            // Method C
            const silicateActual = parseFloat(document.getElementById('silicateActualC')?.value) || 0;
            const naohActual = parseFloat(document.getElementById('naohActualC')?.value) || 0;
            applyActualDeviationStyle('silicateActualC');
            applyActualDeviationStyle('naohActualC');
            
            const silicateQty = silicateActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
            document.getElementById('silicateQtyC').textContent = formatNumber(silicateQty);
            
            if (alkaliType === 'flakes') {
                const naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyC').textContent = formatNumber(naohQty);
            } else {
                const naohData = getNaOHData('C');
                const naohWeight = naohActual * naohData.specWeight;
                const naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyC').textContent = formatNumber(naohQty);
            }
            
        } else if (method === 'tropical-region') {
            // Method D
            const sodaAshActual = parseFloat(document.getElementById('sodaAshActualD')?.value) || 0;
            const naohActual = parseFloat(document.getElementById('naohActualD')?.value) || 0;
            applyActualDeviationStyle('sodaAshActualD');
            applyActualDeviationStyle('naohActualD');
            
            const sodaAshQty = sodaAshActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
            document.getElementById('sodaAshQtyD').textContent = formatNumber(sodaAshQty);
            
            if (alkaliType === 'flakes') {
                const naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyD').textContent = formatNumber(naohQty);
            } else {
                const naohData = getNaOHData('D');
                const naohWeight = naohActual * naohData.specWeight;
                const naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                document.getElementById('naohQtyD').textContent = formatNumber(naohQty);
            }
        }
        
        // Update work order after quantity calculation
        updateWorkOrder();
}

        // 更新「目前使用方法」提示 — 因為方法/NaOH類型的選擇區已經搬到染料配方前面,
        // 這裡加一個簡短提示,讓人滑到鹼劑配方表格時不必往上滑就知道現在用的是哪個方法、哪種 NaOH 類型
        function updateCurrentMethodBanner() {
            const banner = document.getElementById('currentMethodBanner');
            if (!banner) return;
            const method = document.getElementById('alkaliMethod').value;
            const t2 = translations[currentLang];
            const methodNames = {
                'silicate-free': t2.methodA,
                'sodium-silicate': t2.methodB,
                'modified-silicate': t2.methodC,
                'tropical-region': t2.methodD
            };
            const typeSelectId = method === 'silicate-free' ? 'alkaliTypeA' :
                                  method === 'sodium-silicate' ? 'naohConcB' :
                                  method === 'modified-silicate' ? 'naohConcC' : 'naohConcD';
            const typeVal = document.getElementById(typeSelectId).value;
            let typeLabel;
            if (typeVal === 'custom') {
                typeLabel = currentLang === 'zh' ? '自定義波美度' : 'Custom Baumé';
            } else if (typeVal === 'flakes') {
                typeLabel = currentLang === 'zh' ? '片鹼' : (getNaOHDisplayName() + ' Flakes');
            } else {
                typeLabel = `${getNaOHDisplayName()} ${typeVal}°Bé`;
            }
            const prefix = currentLang === 'zh' ? '目前使用: ' : 'Currently using: ';
            banner.textContent = `${prefix}${methodNames[method]} · ${typeLabel}`;
        }

        // ========== 染色完成記錄:軋吸結束時間 + 建議水洗時間 ==========
        // 這個區塊的輸入(軋吸結束時間)不屬於配方本身,不存進 localStorage,
        // 每次載入配方都是空的——使用者染完那批之後現開現填,按「現在」或手動輸入都可以

        // 「現在」按鈕:帶入當下的日期+時間,格式要符合 datetime-local 輸入框要求(YYYY-MM-DDTHH:mm)
        function setPaddingEndTimeNow() {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const localValue = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
            document.getElementById('paddingEndTime').value = localValue;
            updateWorkOrder();
        }

        // 把日期時間格式化成好讀的顯示格式,中英文各自習慣不同的順序,都帶上星期避免看錯日子
        function formatDateTimeDisplay(date) {
            if (!date || isNaN(date.getTime())) return '-';
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            return `${month}/${day} ${hh}:${mm}`;
        }

        // 建議水洗時間 = 軋吸結束時間 + 堆置時間(小時)。兩個值都要有效才算,
        // 缺一個就回傳 null,呼叫端據此決定要不要顯示結果
        function computeSuggestedWashTime() {
            const paddingEndVal = document.getElementById('paddingEndTime')?.value;
            const batchTimeVal = parseFloat(document.getElementById('batchTime')?.value);
            if (!paddingEndVal || isNaN(batchTimeVal) || batchTimeVal <= 0) return null;

            const paddingEndDate = new Date(paddingEndVal);
            if (isNaN(paddingEndDate.getTime())) return null;

            const washDate = new Date(paddingEndDate.getTime() + batchTimeVal * 60 * 60 * 1000);
            return { paddingEndDate, washDate };
        }

        // 同步更新「染色完成記錄」卡片本身的顯示,以及工作單裡對應的兩行(沒填就整段隱藏,
        // 避免大部分還在規劃階段就印出來的工單上出現兩行沒意義的「-」)
        function updateWashTimeDisplay() {
            const result = computeSuggestedWashTime();
            const resultBox = document.getElementById('washTimeResultBox');
            const prompt = document.getElementById('washTimePrompt');
            const woRow = document.getElementById('woPaddingTimeRow');
            if (!resultBox || !woRow) return; // 尚未初始化到這段 DOM 之前先跳過

            if (result) {
                document.getElementById('suggestedWashTimeDisplay').textContent = formatDateTimeDisplay(result.washDate);
                resultBox.classList.remove('hidden');
                if (prompt) prompt.classList.add('hidden');

                document.getElementById('woPaddingEndTime').textContent = formatDateTimeDisplay(result.paddingEndDate);
                document.getElementById('woSuggestedWashTime').textContent = formatDateTimeDisplay(result.washDate);
                woRow.classList.remove('hidden');
            } else {
                resultBox.classList.add('hidden');
                if (prompt) prompt.classList.remove('hidden');
                woRow.classList.add('hidden');
            }
        }

        // Update Work Order Summary - Fixed format with 4 dye rows + 3 auxiliary rows
        function updateWorkOrder() {
            updateCurrentMethodBanner();
            renderAlkaliBasisTable();
            updateWashTimeDisplay();
            const t = translations[currentLang];
            
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];
            document.getElementById('woDate').textContent = dateStr;
            
            // Customer information
const customer = document.getElementById('customerName')?.value || '-';
const colorOrder = document.getElementById('colorOrder')?.value || '-';
const fabricType = document.getElementById('fabricType')?.value || '-';
const batchTime = document.getElementById('batchTime')?.value || '20';

document.getElementById('woCustomer').textContent = customer;
document.getElementById('woColorOrder').textContent = colorOrder;
document.getElementById('woFabricType').textContent = fabricType;
document.getElementById('woBatchTime').textContent = batchTime + ' ' + (currentLang === 'zh' ? '小時' : 'hrs');

// 車速 + 預估軋吸時間(車速+布長都有填才算得出時間),顯示在工卡第五排,車速在左、預估時間在右
const runningSpeedWO = parseFloat(document.getElementById('runningSpeed')?.value) || 0;
const fabricLengthWO = parseFloat(document.getElementById('fabricLength')?.value) || 0;
const woRunningSpeedEl = document.getElementById('woRunningSpeed');
if (woRunningSpeedEl) {
    woRunningSpeedEl.textContent = runningSpeedWO > 0 ? `${formatNumber(runningSpeedWO)} m/min` : '-';
}
const woEstTimeEl = document.getElementById('woEstimatedTime');
if (woEstTimeEl) {
    if (runningSpeedWO > 0 && fabricLengthWO > 0) {
        const totalMinutesWO = fabricLengthWO / runningSpeedWO;
        const hoursWO = Math.floor(totalMinutesWO / 60);
        const minutesWO = Math.round(totalMinutesWO % 60);
        woEstTimeEl.textContent = currentLang === 'zh' ? `${hoursWO} 小時 ${minutesWO} 分鐘` : `${hoursWO}h ${minutesWO}min`;
    } else {
        woEstTimeEl.textContent = '-';
    }
}
            
            const fabricQty = parseFloat(document.getElementById('fabricQuantity').value) || 0;
            document.getElementById('woFabric').textContent = formatNumber(fabricQty) + ' kg';
            
            const pickUp = parseFloat(document.getElementById('pickUp').value) || 0;
            document.getElementById('woPickup').textContent = pickUp + '%';
            
            const method = document.getElementById('alkaliMethod').value;
            const methodNames = {
                'silicate-free': t.methodA,
                'sodium-silicate': t.methodB,
                'modified-silicate': t.methodC,
                'tropical-region': t.methodD
            };
            document.getElementById('woMethod').textContent = methodNames[method];
            
            // Calculate theoretical solution
            const theoretical = fabricQty * pickUp / 100;
            const theoreticalDye = theoretical * DYE_ALKALI_RATIO / (DYE_ALKALI_RATIO + 1);
            const theoreticalAlkali = theoretical * 1 / (DYE_ALKALI_RATIO + 1);
            
            // Get actual solutions
            const dyeSol = parseFloat(document.getElementById('dyeSolution').value) || 0;
            const alkaliSol = parseFloat(document.getElementById('alkaliSolution').value) || 0;
            const totalActual = dyeSol + alkaliSol;
            
            // Calculate differences
            const dyeDiff = dyeSol - theoreticalDye;
            const alkaliDiff = alkaliSol - theoreticalAlkali;
            const totalDiff = totalActual - theoretical;
            
            const dyeLabel = currentLang === 'zh' ? '染料' : 'Dye';
            const alkaliLabel = currentLang === 'zh' ? '鹼劑' : 'Alkali';
            
            document.getElementById('woTotalSol').innerHTML = `
                <div>${formatNumber(theoretical)} ltr</div>
            `;
            document.getElementById('woTheoreticalNote').innerHTML = `
                <span>${dyeLabel} ${formatNumber(theoreticalDye)}</span>
                <span>${alkaliLabel} ${formatNumber(theoreticalAlkali)}</span>
            `;
            document.getElementById('woDyeSol').innerHTML = `
                <div>${formatNumber(dyeSol)} ltr</div>
                <div class="text-xs ${dyeDiff >= 0 ? 'text-gray-600' : 'text-red-600'}">(${dyeDiff >= 0 ? '+' : ''}${formatNumber(dyeDiff)})</div>
            `;
            document.getElementById('woAlkaliSol').innerHTML = `
                <div>${formatNumber(alkaliSol)} ltr</div>
                <div class="text-xs ${alkaliDiff >= 0 ? 'text-gray-600' : 'text-red-600'}">(${alkaliDiff >= 0 ? '+' : ''}${formatNumber(alkaliDiff)})</div>
            `;
            
            // Populate dye table - 列數跟著目前畫面上實際的染料列數走,不是寫死 4 列
            const dyeTableBody = document.getElementById('woDyeTable');
            dyeTableBody.innerHTML = '';
            
            const dyeInputs = document.querySelectorAll('#dyeTableBody tr[data-row-type="dye"] .dye-recipe');
            const dyeNames = document.querySelectorAll('#dyeTableBody tr[data-row-type="dye"] input[type="text"]');
            let totalDyeConc = 0;
            
            for (let i = 0; i < dyeInputs.length; i++) {
                const recipe = parseFloat(dyeInputs[i]?.value) || 0;
                const name = getNameOrPlaceholder(dyeNames[i]) || '-';
                const motherLiquorConc = recipe * MOTHER_LIQUOR_DYE_MULTIPLIER;
                const quantity = motherLiquorConc * dyeSol;
                totalDyeConc += recipe;
                
                dyeTableBody.innerHTML += `
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${name}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${recipe > 0 ? formatNumber(recipe) : '-'}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${recipe > 0 ? formatNumber(quantity) : '-'}</td>
                    </tr>
                `;
            }
            
            // Add total dye row
            const totalLabel = currentLang === 'zh' ? '總計:' : 'Total:';
            dyeTableBody.innerHTML += `
                <tr class="bg-gray-100 font-bold">
                    <td class="border border-gray-300 px-2 sm:px-3 py-2"></td>
                    <td class="border border-gray-300 px-2 sm:px-3 py-2">${totalLabel} ${formatNumberPlain(totalDyeConc)} g/l</td>
                    <td class="border border-gray-300 px-2 sm:px-3 py-2"></td>
                </tr>
            `;
            
            // Populate auxiliary rows - 列數跟著目前畫面上實際的助劑列數走,不是寫死 3 列
            const auxInputs = document.querySelectorAll('#dyeTableBody tr[data-row-type="aux"] .aux-recipe');
            const auxNames = document.querySelectorAll('#dyeTableBody tr[data-row-type="aux"] input[type="text"]');
            
            for (let i = 0; i < auxInputs.length; i++) {
                const recipe = parseFloat(auxInputs[i]?.value) || 0;
                const name = getNameOrPlaceholder(auxNames[i]) || '-';
                const motherLiquorConc = recipe * MOTHER_LIQUOR_DYE_MULTIPLIER;
                const quantity = motherLiquorConc * dyeSol;
                
                dyeTableBody.innerHTML += `
                    <tr class="bg-blue-50">
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${name}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${recipe > 0 ? formatNumber(recipe) : '-'}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${recipe > 0 ? formatNumber(quantity) : '-'}</td>
                    </tr>
                `;
            }
            
// Populate alkali table - read actual values and display as text
            const alkaliTableBody = document.getElementById('woAlkaliTable');
            // alkaliSol already declared above, use existing variable
            
            let alkaliRows = '';
            
            if (method === 'silicate-free') {
                // Method A
                const totalDyeForWO = parseFloat(document.getElementById('totalDyeConc')?.textContent) || 0;
                const { alkaliType, naohData, sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit } = computeMethodASuggestion(totalDyeForWO);
                const sodaAshActual = parseFloat(document.getElementById('sodaAshActualA')?.value) || sodaAshSuggested;
                const sodaAshQty = sodaAshActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                
                const naohActual = parseFloat(document.getElementById('naohActualA')?.value) || 0;
                let naohQty;
                if (alkaliType === 'flakes') {
                    naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                } else {
                    const naohWeight = naohActual * naohData.specWeight;
                    naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                }
                
                // 工卡只顯示實際配方(執行用),建議值移到表格上方當附註,方便日後回溯比對
                document.getElementById('woAlkaliSuggestedNote').textContent =
                    (currentLang === 'zh' ? '建議配方參考: ' : 'Suggested reference: ')
                    + `${sodaAshLabel} ${sodaAshSuggested} g/l · ${naohLabel} ${naohSuggested} ${naohUnit}`;
                
                let actualDisplay, qtyDisplay;
                if (alkaliType === 'flakes') {
                    actualDisplay = `${formatNumber(naohActual)} g/l`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                } else {
                    const actualWeight = (naohActual * naohData.specWeight).toFixed(1);
                    actualDisplay = `${formatNumber(naohActual)} ml/l<div class="text-xs text-blue-600">= ${formatNumber(parseFloat(actualWeight))} g/l</div>`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                }
                
                alkaliRows = `
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${sodaAshLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${formatNumber(sodaAshActual)} g/l</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${formatNumber(sodaAshQty)} g</td>
                    </tr>
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${naohLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${actualDisplay}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${qtyDisplay}</td>
                    </tr>
                `;
                
            } else if (method === 'sodium-silicate') {
                // Method B
                const totalDye = parseFloat(document.getElementById('totalDyeConc')?.textContent) || 0;
                const { naohConc, naohData, silicateConc, silicateSuggested, naohLabel, naohSuggested, naohUnit } = computeMethodBSuggestion(totalDye);
                const silicateActual = parseFloat(document.getElementById('silicateActualB')?.value) || silicateSuggested;
                const silicateQty = silicateActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                
                const naohActual = parseFloat(document.getElementById('naohActualB')?.value) || 0;
                let naohQty;
                if (naohConc === 'flakes') {
                    naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                } else {
                    const naohWeight = naohActual * naohData.specWeight;
                    naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                }
                
                const sodiumSilicateLabel = currentLang === 'zh' ? '水玻璃' : 'Sodium Silicate';
                const silicateItemLabel = `${sodiumSilicateLabel} ${silicateConc}°Bé`;
                
                document.getElementById('woAlkaliSuggestedNote').textContent =
                    (currentLang === 'zh' ? '建議配方參考: ' : 'Suggested reference: ')
                    + `${silicateItemLabel} ${silicateSuggested} g/l · ${naohLabel} ${naohSuggested} ${naohUnit}`;
                
                let actualDisplay, qtyDisplay;
                if (naohConc === 'flakes') {
                    actualDisplay = `${formatNumber(naohActual)} g/l`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                } else {
                    const actualWeight = (naohActual * naohData.specWeight).toFixed(1);
                    actualDisplay = `${formatNumber(naohActual)} ml/l<div class="text-xs text-blue-600">= ${formatNumber(parseFloat(actualWeight))} g/l</div>`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                }
                
                alkaliRows = `
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${silicateItemLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${formatNumber(silicateActual)} g/l</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${formatNumber(silicateQty)} g</td>
                    </tr>
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${naohLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${actualDisplay}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${qtyDisplay}</td>
                    </tr>
                `;
                
            } else if (method === 'modified-silicate') {
                // Method C
                const totalDye = parseFloat(document.getElementById('totalDyeConc')?.textContent) || 0;
                const { naohConc, naohData, silicateConc, silicateSuggested, naohLabel, naohSuggested, naohUnit } = computeMethodCSuggestion(totalDye);
                const silicateActual = parseFloat(document.getElementById('silicateActualC')?.value) || silicateSuggested;
                const silicateQty = silicateActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                
                const naohActual = parseFloat(document.getElementById('naohActualC')?.value) || 0;
                let naohQty;
                if (naohConc === 'flakes') {
                    naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                } else {
                    const naohWeight = naohActual * naohData.specWeight;
                    naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                }
                
                const sodiumSilicateLabel = currentLang === 'zh' ? '水玻璃' : 'Sodium Silicate';
                const silicateItemLabel = `${sodiumSilicateLabel} ${silicateConc}°Bé`;
                
                document.getElementById('woAlkaliSuggestedNote').textContent =
                    (currentLang === 'zh' ? '建議配方參考: ' : 'Suggested reference: ')
                    + `${silicateItemLabel} ${silicateSuggested} g/l · ${naohLabel} ${naohSuggested} ${naohUnit}`;
                
                let actualDisplay, qtyDisplay;
                if (naohConc === 'flakes') {
                    actualDisplay = `${formatNumber(naohActual)} g/l`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                } else {
                    const actualWeight = (naohActual * naohData.specWeight).toFixed(1);
                    actualDisplay = `${formatNumber(naohActual)} ml/l<div class="text-xs text-blue-600">= ${formatNumber(parseFloat(actualWeight))} g/l</div>`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                }
                
                alkaliRows = `
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${silicateItemLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${formatNumber(silicateActual)} g/l</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${formatNumber(silicateQty)} g</td>
                    </tr>
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${naohLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${actualDisplay}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${qtyDisplay}</td>
                    </tr>
                `;
                
            } else if (method === 'tropical-region') {
                // Method D
                const totalDye = parseFloat(document.getElementById('totalDyeConc')?.textContent) || 0;
                const { naohConc, naohData, sodaAshLabel, sodaAshSuggested, naohLabel, naohSuggested, naohUnit } = computeMethodDSuggestion(totalDye);
                const sodaAshActual = parseFloat(document.getElementById('sodaAshActualD')?.value) || sodaAshSuggested;
                const sodaAshQty = sodaAshActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                
                const naohActual = parseFloat(document.getElementById('naohActualD')?.value) || 0;
                let naohQty;
                if (naohConc === 'flakes') {
                    naohQty = naohActual * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                } else {
                    const naohWeight = naohActual * naohData.specWeight;
                    naohQty = naohWeight * MOTHER_LIQUOR_ALKALI_MULTIPLIER * alkaliSol;
                }
                
                document.getElementById('woAlkaliSuggestedNote').textContent =
                    (currentLang === 'zh' ? '建議配方參考: ' : 'Suggested reference: ')
                    + `${sodaAshLabel} ${sodaAshSuggested} g/l · ${naohLabel} ${naohSuggested} ${naohUnit}`;
                
                let actualDisplay, qtyDisplay;
                if (naohConc === 'flakes') {
                    actualDisplay = `${formatNumber(naohActual)} g/l`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                } else {
                    const actualWeight = (naohActual * naohData.specWeight).toFixed(1);
                    actualDisplay = `${formatNumber(naohActual)} ml/l<div class="text-xs text-blue-600">= ${formatNumber(parseFloat(actualWeight))} g/l</div>`;
                    qtyDisplay = `${formatNumber(naohQty)} g`;
                }
                
                alkaliRows = `
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${sodaAshLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${formatNumber(sodaAshActual)} g/l</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${formatNumber(sodaAshQty)} g</td>
                    </tr>
                    <tr>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${naohLabel}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2">${actualDisplay}</td>
                        <td class="border border-gray-300 px-2 sm:px-3 py-2 font-semibold">${qtyDisplay}</td>
                    </tr>
                `;
            }
            
            alkaliTableBody.innerHTML = alkaliRows;
            
            // Update solution amounts in recipe headers
            document.getElementById('woDyeSolAmount').textContent = formatNumber(dyeSol);
            document.getElementById('woAlkaliSolAmount').textContent = formatNumber(alkaliSol);

            renderWorkOrderPretreatment();
            renderWorkOrderWashing();
            renderWorkOrderResult();
            updatePrintPageBreaks();
        }

        // 染色結果摘要(2026-09-12 改成直接併入工卡):唯讀鏡像顯示「染色結果」分頁裡的照片/備註,
        // 真正的編輯(拍照、上傳、刪除、寫說明)還是在「染色結果」分頁進行,這裡只負責顯示結果——
        // 這樣下載圖片/列印兩條匯出路徑擷取的都是同一份 workOrderSection,樣式自然一致
        function renderWorkOrderResult() {
            const section = document.getElementById('woResultSection');
            const grid = document.getElementById('woResultPhotosGrid');
            const notesEl = document.getElementById('woResultNotes');
            if (!section || !grid || !notesEl) return;

            const notesText = (document.getElementById('dyeResultNotes')?.value || '').trim();
            const hasContent = resultPhotos.length > 0 || notesText !== '';
            if (!hasContent) {
                section.classList.add('hidden');
                return;
            }
            section.classList.remove('hidden');

            grid.innerHTML = resultPhotos.map(photo => `
                <div>
                    <img src="${photo.src}" class="w-full aspect-square object-cover" style="border:1px solid #999;">
                    ${photo.caption ? `<p class="text-xs text-center text-gray-600 mt-1">${photo.caption.replace(/</g, '&lt;')}</p>` : ''}
                </div>
            `).join('');

            notesEl.textContent = notesText;
            notesEl.classList.toggle('hidden', notesText === '');
        }

        // 列印分頁邏輯:染色配方(工卡核心內容)固定印第一頁;前處理/水洗/染色結果
        // 三個裡面,只有「實際有資料的第一個」會被標成第二頁的開頭,其餘接著印在同一頁面往後排——
        // 不是三個各自跳頁,不然沒資料的段落也會佔一張幾乎空白的紙
        function updatePrintPageBreaks() {
            const pretreatSection = document.getElementById('woPretreatmentSection');
            const washSection = document.getElementById('woWashingSection');
            const resultSection = document.getElementById('woResultSection');
            [pretreatSection, washSection, resultSection].forEach(el => el && el.classList.remove('print-page-break'));

            const pretreatVisible = pretreatSection && !pretreatSection.classList.contains('hidden');
            const washVisible = washSection && !washSection.classList.contains('hidden');
            const hasResultContent = resultPhotos.length > 0 || !!(document.getElementById('dyeResultNotes')?.value.trim());

            if (pretreatVisible) {
                pretreatSection.classList.add('print-page-break');
            } else if (washVisible) {
                washSection.classList.add('print-page-break');
            } else if (hasResultContent && resultSection) {
                resultSection.classList.add('print-page-break');
            }
            // 三個都沒資料的話不強制分頁,工卡有多長就印多長,不會多印一張空白頁
        }

        // ========== 工卡:前處理/水洗摘要(2026-09-12 新增)==========
        // 有選方式才顯示,沒選(預設「未使用」)就整塊隱藏,不佔工卡版面
        function renderWorkOrderPretreatment() {
            const t = translations[currentLang];
            const method = document.getElementById('pretreatmentMethod')?.value || '';
            const section = document.getElementById('woPretreatmentSection');
            if (!section) return;
            if (!method) { section.classList.add('hidden'); return; }
            section.classList.remove('hidden');

            const methodNames = { 'continuous': t.pretreatmentContinuous, 'cold-bleach': t.pretreatmentColdBleach, 'jet': t.pretreatmentJet };
            document.getElementById('woPretreatmentMethodName').textContent = methodNames[method] || '';

            function buildStageHtml(rows, temp, time, stageLabel) {
                const filledRows = rows.filter(r => (r.name && r.name.trim()) || (r.value !== '' && r.value !== null && r.value !== undefined));
                let html = '';
                if (stageLabel) html += `<p class="font-semibold text-sm text-gray-700 mt-3 mb-1">${stageLabel}</p>`;
                html += `<table class="w-full text-sm mb-2"><thead><tr class="bg-gray-100">
                    <th class="border border-gray-300 px-2 py-1.5 text-left" style="width:60%;">${t.chemicalName}</th>
                    <th class="border border-gray-300 px-2 py-1.5 text-left">${t.dosageGL}</th>
                </tr></thead><tbody>`;
                if (filledRows.length === 0) {
                    html += `<tr><td class="border border-gray-300 px-2 py-1.5 text-gray-400" colspan="2">-</td></tr>`;
                } else {
                    filledRows.forEach(r => {
                        html += `<tr>
                            <td class="border border-gray-300 px-2 py-1.5">${r.name || '-'}</td>
                            <td class="border border-gray-300 px-2 py-1.5 font-semibold">${r.value !== '' && r.value !== null ? formatNumber(parseFloat(r.value)) + ' g/l' : '-'}</td>
                        </tr>`;
                    });
                }
                html += `</tbody></table>`;
                html += `<p class="text-sm text-gray-600">${t.temperature}: <span class="font-semibold">${temp || '-'}</span>　${t.processTime}: <span class="font-semibold">${time || '-'}</span></p>`;
                return html;
            }

            const contentEl = document.getElementById('woPretreatmentContent');
            if (method === 'continuous') {
                const deminTemp = document.getElementById('pretreatmentDeminTemp')?.value;
                const deminTime = document.getElementById('pretreatmentDeminTime')?.value;
                const bleachTemp = document.getElementById('pretreatmentBleachTemp')?.value;
                const bleachTime = document.getElementById('pretreatmentBleachTime')?.value;
                contentEl.innerHTML =
                    buildStageHtml(pretreatmentRecipes.demin, deminTemp, deminTime, t.pretreatmentDemin) +
                    buildStageHtml(pretreatmentRecipes.bleach, bleachTemp, bleachTime, t.pretreatmentBleach);
            } else {
                const temp = document.getElementById('pretreatmentSingleTemp')?.value;
                const time = document.getElementById('pretreatmentSingleTime')?.value;
                contentEl.innerHTML = buildStageHtml(pretreatmentRecipes.single, temp, time, '');
            }
        }

        function renderWorkOrderWashing() {
            const t = translations[currentLang];
            const method = document.getElementById('washingMethod')?.value || '';
            const section = document.getElementById('woWashingSection');
            if (!section) return;
            if (!method) { section.classList.add('hidden'); return; }
            section.classList.remove('hidden');

            const methodNames = { 'continuous': t.washingContinuous, 'jet': t.washingJet };
            document.getElementById('woWashingMethodName').textContent = methodNames[method] || '';

            const contentEl = document.getElementById('woWashingContent');
            if (method === 'continuous') {
                const speed = document.getElementById('washingRunningSpeed')?.value;
                let html = `<p class="text-sm text-gray-600 mb-2">${t.runningSpeedWashing}: <span class="font-semibold">${speed || '-'}</span></p>`;
                html += `<table class="w-full text-sm"><thead><tr class="bg-gray-100">
                    <th class="border border-gray-300 px-2 py-1.5 text-left" style="width:20%;">${t.stage}</th>
                    <th class="border border-gray-300 px-2 py-1.5 text-left">${t.waterFlow}</th>
                    <th class="border border-gray-300 px-2 py-1.5 text-left">${t.temperature}</th>
                </tr></thead><tbody>`;
                washingStagesContinuous.forEach((row, i) => {
                    html += `<tr>
                        <td class="border border-gray-300 px-2 py-1.5 text-center font-semibold">${i + 1}</td>
                        <td class="border border-gray-300 px-2 py-1.5">${row.flow || '-'}</td>
                        <td class="border border-gray-300 px-2 py-1.5">${row.temp || '-'}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                contentEl.innerHTML = html;
            } else {
                let html = `<table class="w-full text-sm"><thead><tr class="bg-gray-100">
                    <th class="border border-gray-300 px-2 py-1.5 text-left" style="width:20%;">${t.stage}</th>
                    <th class="border border-gray-300 px-2 py-1.5 text-left">${t.temperature}</th>
                    <th class="border border-gray-300 px-2 py-1.5 text-left">${t.processTime}</th>
                </tr></thead><tbody>`;
                washingStagesJet.forEach((row, i) => {
                    html += `<tr>
                        <td class="border border-gray-300 px-2 py-1.5 text-center font-semibold">${i + 1}</td>
                        <td class="border border-gray-300 px-2 py-1.5">${row.temp || '-'}</td>
                        <td class="border border-gray-300 px-2 py-1.5">${row.time || '-'}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                contentEl.innerHTML = html;
            }
        }

        // Initialize
        updateRecipeList();

        // 全域防呆:min="0" 這類 HTML 屬性只會讓瀏覽器把欄位標成 :invalid(樣式提示),
        // 並不會真的阻止使用者直接打出超出範圍的數字,inline oninput 還是會照樣把負數拿去算,
        // 算出負的溶液量、負的用量。這裡在 capture 階段(比 inline oninput 更早執行)先把
        // 數值夾回 min/max 範圍內,確保 calculate() 看到的一定是合法數字。
        document.addEventListener('input', function(e) {
            const el = e.target;
            // customBaume 系列欄位有自己專屬的驗證/警示邏輯(見 updateCustomNaOH),
            // 不要在這裡先幫它夾值,否則「超出範圍」的警示訊息永遠不會被觸發
            if (el.tagName === 'INPUT' && el.type === 'number' && el.value !== '' && !isNaN(el.value)
                && !el.id.startsWith('customBaume')) {
                const val = parseFloat(el.value);
                if (el.min !== '' && !isNaN(parseFloat(el.min)) && val < parseFloat(el.min)) {
                    el.value = el.min;
                } else if (el.max !== '' && !isNaN(parseFloat(el.max)) && val > parseFloat(el.max)) {
                    el.value = el.max;
                }
            }
        }, true);

        // 自動存草稿:document 層級監聽 input/change,涵蓋絕大多數欄位(打字、下拉選單、
        // 日期時間欄位)不用每個欄位額外加 oninput——debounce 0.5 秒,連續打字時不會每個
        // 按鍵都寫一次 localStorage
        document.addEventListener('input', scheduleAutoSave);
        document.addEventListener('change', scheduleAutoSave);

        restoreDraftOnLoad();
        calculate();
        updateWorkOrder();
        initQuickNavScrollSpy();
        initPageTabs();

        // ========== Page-level Tabs(配方設定 / 工卡) ==========
        // 頂層分頁,跟下面 Quick Jump Nav(區塊內捲動跳轉)是不同層級——
        // 「配方設定」還是原本連續捲動的那一整頁,「工卡」是獨立、唯讀的工作單預覽頁
        function switchPageTab(tab) {
            const panels = { form: 'formTabPanel', pretreatment: 'pretreatmentTabPanel', washing: 'washingTabPanel', card: 'cardTabPanel', result: 'resultTabPanel' };
            const quickNav = document.getElementById('quickNav');

            Object.entries(panels).forEach(([key, panelId]) => {
                const panel = document.getElementById(panelId);
                const btn = document.querySelector(`.page-tab-btn[data-tab="${key}"]`);
                if (panel) panel.classList.toggle('hidden', key !== tab);
                if (btn) btn.classList.toggle('active', key === tab);
            });
            // Quick Jump Nav 只在「配方設定」分頁有意義(其他分頁是單一畫面,沒有區塊可以跳)
            if (quickNav) quickNav.classList.toggle('hidden', tab !== 'form');
            // 切分頁時捲回頂部,避免停留在原分頁捲動到一半的位置,看起來像是空白畫面
            window.scrollTo({ top: 0, behavior: 'auto' });
        }

        // pageTabs 跟 quickNav 都是 sticky 貼頂,兩條要上下疊好、不能互相蓋住——
        // 用實際量到的 pageTabs 高度動態設定 quickNav 的 sticky top,不用去猜固定數字
        function syncStickyNavOffsets() {
            const pageTabs = document.getElementById('pageTabs');
            const quickNav = document.getElementById('quickNav');
            if (pageTabs && quickNav) {
                quickNav.style.top = pageTabs.offsetHeight + 'px';
            }
        }

        function initPageTabs() {
            syncStickyNavOffsets();
            window.addEventListener('resize', syncStickyNavOffsets);
        }

        // ========== Quick Jump Nav ==========
        // 點按鈕捲動到對應區塊(不是切換隱藏面板),留一點頂部間距避免被 sticky 導覽列(pageTabs + quickNav
        // 兩條疊在一起)自己擋住
        function scrollToQuickNavSection(id) {
            const el = document.getElementById(id);
            if (!el) return;
            const pageTabsEl = document.getElementById('pageTabs');
            const navEl = document.getElementById('quickNav');
            const offset = (pageTabsEl ? pageTabsEl.offsetHeight : 0) + (navEl ? navEl.offsetHeight : 50) + 10;
            const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
            window.scrollTo({ top, behavior: 'smooth' });
        }

        // 布量/軋吸率還沒填好時,「染料/鹼劑配方」這個按鈕對應的區塊其實還是隱藏的,
        // 跳過去也只會看到提示卡片——直接把按鈕標成不可點,比跳過去才發現「什麼都沒有」更清楚。
        // 「工卡」「染色結果」兩個分頁改成不設閘門,一開始就看得到工卡/記錄區塊的完整版面
        // (客戶/顏色/布量等欄位沒填就顯示"-",配方數字沒填就是 0,不會因為前面沒填而整頁空白)。
        function updateQuickNavAvailability(hasValidFabricInputs) {
            const gatedTargets = ['sectionDyeRecipe'];
            gatedTargets.forEach(id => {
                const btn = document.querySelector(`.quick-nav-btn[data-target="${id}"]`);
                if (btn) btn.disabled = !hasValidFabricInputs;
            });

            const workOrderEl = document.getElementById('workOrderSection');
            const cardPromptEl = document.getElementById('cardTabPrompt');
            if (workOrderEl && cardPromptEl) {
                workOrderEl.classList.remove('hidden');
                cardPromptEl.classList.add('hidden');
            }
            const resultSectionEl = document.getElementById('resultSection');
            const resultPromptEl = document.getElementById('resultCardPrompt');
            if (resultSectionEl && resultPromptEl) {
                resultSectionEl.classList.remove('hidden');
                resultPromptEl.classList.add('hidden');
            }
        }

        // 捲動時自動高亮目前所在區塊對應的按鈕,讓使用者隨時知道自己捲到流程的哪一段
        // 「染料/鹼劑配方」這顆按鈕對應兩個區塊(染料配方 + 鹼劑配方,兩者緊鄰),
        // 所以 sectionAlkaliSystem 也一併觀察,但對應回同一顆按鈕,不用另外佔一顆
        function initQuickNavScrollSpy() {
            const idToButtonTarget = {
                sectionOrder: 'sectionOrder',
                sectionAlkaliMethod: 'sectionAlkaliMethod',
                sectionDyeRecipe: 'sectionDyeRecipe',
                sectionAlkaliSystem: 'sectionDyeRecipe'
            };
            const buttons = {};
            Object.values(idToButtonTarget).forEach(targetId => {
                const btn = document.querySelector(`.quick-nav-btn[data-target="${targetId}"]`);
                if (btn) buttons[targetId] = btn;
            });
            if (!('IntersectionObserver' in window)) return; // 極舊瀏覽器沒有就跳過,不影響其他功能

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const btn = buttons[idToButtonTarget[entry.target.id]];
                    if (!btn) return;
                    Object.values(buttons).forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });

            Object.keys(idToButtonTarget).forEach(id => {
                const el = document.getElementById(id);
                if (el) observer.observe(el);
            });
        }

        // 註冊 Service Worker，統一路徑為 ./sw.js
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
                    .then((registration) => registration.update())
                    .catch((err) => {
                        console.warn('Service worker registration failed:', err);
                    });
            });
        }
