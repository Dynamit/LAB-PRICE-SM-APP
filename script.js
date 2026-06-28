// Global variables
let labPrices = []; // To store test codes, names, and their private/tourist prices
let labDetails = {}; // ACTIVE details book (alias -> points to the selected branch's book)
let labDetailsRamatHahayal = {}; // Ramat HaHayal test book
let labDetailsHaifa = {}; // Haifa test book
let currentPriceType = null; // No default — the user must explicitly choose a price list
let currentBranch = null;    // No default — the user must explicitly choose a lab
let selectedLabTests = []; // Array to store currently selected lab tests

// Branch registry: display labels only. Prices and PDF contact details are identical across branches.
const BRANCHES = {
    ramat_hahayal: { label: "רמת החייל" },
    haifa: { label: "חיפה" }
};

// Price-list display labels (used in the quote PDF).
const PRICE_LABELS = { private: "מטופל פרטי", tourist: "תייר" };

// Keep the active-book alias in sync with the selected branch.
function applyActiveBranchDetails() {
    labDetails = (currentBranch === "haifa") ? labDetailsHaifa : labDetailsRamatHahayal;
}

// Per-branch ordered detail fields (JSON key -> display label). Ramat HaHayal keeps its
// original 6 fields; Haifa shows the columns requested from the Haifa book (C,D,H,I,J,M,O,P,Q,R).
const BRANCH_DETAIL_FIELDS = {
    ramat_hahayal: [
        { key: "patient_preparation_conditions", label: "תנאים והכנת החולה לפני הדיגום" },
        { key: "tubes", label: "מבחנות נדרשות" },
        { key: "sampling_conditions", label: "תנאי לקיחה ושימור" },
        { key: "transport_instructions", label: "הוראות שינוע" },
        { key: "execution_time_info", label: "מידע על זמן ביצוע" },
        { key: "results_time", label: "משך זמן לקבלת תשובה", suffix: " (ימי עבודה)" }
    ],
    haifa: [
        { key: "test_name_book", label: "שם הבדיקה" },
        { key: "code_tfnit", label: "קוד תפנית" },
        { key: "patient_preparation_conditions", label: "תנאים פרה אנליטיים (דרישות מיוחדות)" },
        { key: "sampling_conditions", label: "תנאי לקיחה" },
        { key: "tubes", label: "כלי קיבול לדגימה / מבחנה / צנצנת" },
        { key: "execution_time_info", label: "זמן מירבי מדיגום עד הגעה למעבדה" },
        { key: "performing_lab", label: "מעבדה מבצעת" },
        { key: "results_time", label: "משך הזמן עד הוצאת תשובה (ימי עבודה)" },
        { key: "storage_conditions", label: "תנאי שימור וטיפול בדגימה" },
        { key: "transport_instructions", label: "תנאי שינוע" }
    ]
};

// Build the <p> detail rows for the active branch's field set.
function renderDetailRows(details) {
    const fields = BRANCH_DETAIL_FIELDS[currentBranch] || BRANCH_DETAIL_FIELDS.ramat_hahayal;
    return fields
        .map(f => `<p><strong>${f.label}:</strong> ${details[f.key] || "לא צוין"}${f.suffix || ""}</p>`)
        .join("\n                ");
}

// Escape user-facing data before injecting via innerHTML.
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Normalize text for search: lowercase, strip everything except Latin/Hebrew letters and
// digits, so punctuation and spacing don't affect matching ("anti ttg" matches "Anti-TTG").
function normalizeForSearch(value) {
    return String(value || "").toLowerCase().replace(/[^0-9a-z֐-׿]/g, "");
}

// One test row: code – name – price, each isolated with <bdi> so RTL/LTR mixing can't
// reorder it and the price stays glued to "ש"ח". priceText is already formatted.
function formatTestLine(test, priceText) {
    return `(<bdi>${escapeHtml(test.test_code)}</bdi>) - <bdi>${escapeHtml(test.test_name)}</bdi> - <bdi>${priceText} ש"ח</bdi>`;
}

// Base prices for nurse visit
const NURSE_VISIT_BASE_PRICE_PRIVATE = 710;
const NURSE_VISIT_BASE_PRICE_TOURIST = 860;

function getCurrentNurseBasePrice() {
    return currentPriceType === "tourist" ? NURSE_VISIT_BASE_PRICE_TOURIST : NURSE_VISIT_BASE_PRICE_PRIVATE;
}

document.addEventListener("DOMContentLoaded", async () => {
    // DOM Elements
    const appMain = document.getElementById("appMain");
    const branchButtons = document.getElementById("branchButtons");
    const priceButtons = document.getElementById("priceButtons");
    const selectionHint = document.getElementById("selectionHint");
    const detailsBranchLabel = document.getElementById("detailsBranchLabel");

    const nurseVisitBasePriceSpan = document.getElementById("nurseBasePrice");

    const testSearchInput = document.getElementById("testSearch");
    const searchResultsDiv = document.getElementById("testSuggestions");
    const selectedTestsUl = document.getElementById("selectedTestsList");
    const labTestsSubtotalSpan = document.getElementById("labTestsSubtotal");

    const testDetailsContentDiv = document.getElementById("testDetailsContent");

    const summaryNursePriceSpan = document.getElementById("summaryNursePrice");
    const summaryLabTestsPriceSpan = document.getElementById("summaryLabTestsPrice");
    const finalPriceSpan = document.getElementById("finalAmount");

    const toggleBaseDiscountBtn = document.getElementById("toggleBaseDiscountBtn");
    const baseDiscountContainer = document.getElementById("baseDiscountContainer");
    const baseDiscountInput = document.getElementById("basePackageDiscount");

    const exportPdfButton = document.getElementById("exportPdfButton");
    const exportStaffPdfButton = document.getElementById("exportStaffPdfButton");
    const clearAllBtn = document.getElementById("clearAllBtn");

    // Search keyboard-navigation state
    let currentMatches = [];
    let activeIndex = -1;

    const STORAGE_KEY = "labPriceCalcState_v1";

    // --- Initialization ---
    async function initializeApp() {
        console.log("Initializing app...");
        await Promise.all([
            loadLabPrices(),
            loadLabDetails(),
            loadLabDetailsHaifa()
        ]);
        loadState();
        applyActiveBranchDetails();
        syncSelectionUI();
        renderSelectedTests();
        if (selectedLabTests.length > 0) {
            displayTestDetails(selectedLabTests[selectedLabTests.length - 1].test_code);
        }
        updateCalculations();
    }

    // --- Selection (lab + price list) gating ---
    // The rest of the calculator stays locked until BOTH a lab and a price list are chosen.
    function isReady() {
        return !!currentBranch && !!currentPriceType;
    }

    function markActive(container, attr, value) {
        if (!container) return;
        container.querySelectorAll("button").forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-" + attr) === value);
        });
    }

    function updateReadyState() {
        const ready = isReady();
        if (appMain) appMain.classList.toggle("not-ready", !ready);
        if (selectionHint) selectionHint.classList.toggle("hidden", ready);
        if (testSearchInput) testSearchInput.disabled = !ready;
        if (exportPdfButton) exportPdfButton.disabled = !ready;
        if (exportStaffPdfButton) exportStaffPdfButton.disabled = !ready;
        if (toggleBaseDiscountBtn) toggleBaseDiscountBtn.disabled = !ready;
        if (!ready) closeSuggestions();
    }

    // Reflect current selection state in the buttons + readiness (used on load).
    function syncSelectionUI() {
        markActive(branchButtons, "branch", currentBranch);
        markActive(priceButtons, "price", currentPriceType);
        if (detailsBranchLabel && currentBranch) detailsBranchLabel.textContent = BRANCHES[currentBranch].label;
        updateReadyState();
    }

    // --- State persistence (localStorage) ---
    function saveState() {
        try {
            const state = {
                branch: currentBranch,
                priceType: currentPriceType,
                codes: selectedLabTests.map(t => String(t.test_code)),
                discountOpen: baseDiscountContainer ? !baseDiscountContainer.classList.contains("hidden") : false,
                discountValue: baseDiscountInput ? baseDiscountInput.value : 0
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            // localStorage unavailable (private mode / disabled) — ignore, app still works.
        }
    }

    function loadState() {
        let state;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            state = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!state) return;

        if (state.branch && BRANCHES[state.branch]) {
            currentBranch = state.branch;
            if (detailsBranchLabel) detailsBranchLabel.textContent = BRANCHES[currentBranch].label;
        }
        if (state.priceType && PRICE_LABELS[state.priceType]) {
            currentPriceType = state.priceType;
        }
        if (Array.isArray(state.codes)) {
            // Re-resolve from the current price list so prices stay up to date.
            selectedLabTests = state.codes
                .map(code => labPrices.find(t => String(t.test_code) === String(code)))
                .filter(Boolean);
        }
        if (baseDiscountContainer && baseDiscountInput) {
            if (state.discountOpen) {
                baseDiscountContainer.classList.remove("hidden");
                baseDiscountInput.value = state.discountValue || 0;
            } else {
                baseDiscountContainer.classList.add("hidden");
                baseDiscountInput.value = 0;
            }
        }
    }

    // --- Data Loading Functions ---
    async function loadLabPrices() {
        const jsonPath = "assets/data/lab_prices.json";
        try {
            const response = await fetch(jsonPath);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            labPrices = await response.json();
            console.log("Lab prices loaded successfully:", labPrices.length, "items");
            if (labPrices.length === 0) {
                if(searchResultsDiv) searchResultsDiv.innerHTML = 
                    `<p style=\"color: red;\">קובץ מחירי הבדיקות נטען אך הוא ריק.</p>`;
            }
        } catch (error) {
            console.error("Error loading lab prices:", error);
            if(searchResultsDiv) searchResultsDiv.innerHTML = 
                `<p style=\"color: red;\">שגיאה בטעינת מחירי הבדיקות: ${error.message}.</p>`;
        }
    }

    async function loadLabDetails() {
        const jsonPath = "assets/data/lab_details.json";
        try {
            const response = await fetch(jsonPath);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            labDetailsRamatHahayal = await response.json();
            console.log("Ramat HaHayal details loaded. Entries:", Object.keys(labDetailsRamatHahayal).length);
        } catch (error) {
            console.error("Error loading Ramat HaHayal details:", error);
            if(testDetailsContentDiv) testDetailsContentDiv.innerHTML =
                `<p style=\"color: red;\">שגיאה בטעינת פרטי הבדיקות: ${error.message}.</p>`;
        }
    }

    async function loadLabDetailsHaifa() {
        const jsonPath = "assets/data/lab_details_haifa.json";
        try {
            const response = await fetch(jsonPath);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            labDetailsHaifa = await response.json();
            console.log("Haifa details loaded. Entries:", Object.keys(labDetailsHaifa).length);
        } catch (error) {
            // Non-fatal: leave the Haifa book empty so its tests fall back to "no details".
            // Do NOT clobber the details panel — the default Ramat HaHayal branch must stay clean.
            console.error("Error loading Haifa details:", error);
        }
    }

    // --- Event Listeners ---
    // Lab buttons: switch the active details book only (prices/selection are unaffected).
    if (branchButtons) branchButtons.addEventListener("click", (event) => {
        const btn = event.target;
        const value = btn && btn.getAttribute ? btn.getAttribute("data-branch") : null;
        if (!value || !BRANCHES[value]) return;
        currentBranch = value;
        markActive(branchButtons, "branch", value);
        applyActiveBranchDetails();
        if (detailsBranchLabel) detailsBranchLabel.textContent = BRANCHES[currentBranch].label;
        if (selectedLabTests.length > 0) {
            displayTestDetails(selectedLabTests[selectedLabTests.length - 1].test_code);
        } else if (testDetailsContentDiv) {
            testDetailsContentDiv.innerHTML = "<p>בחר בדיקה מהרשימה כדי לראות את פרטיה.</p>";
        }
        updateReadyState();
        saveState();
    });

    // Price-list buttons: change which price column is used.
    if (priceButtons) priceButtons.addEventListener("click", (event) => {
        const btn = event.target;
        const value = btn && btn.getAttribute ? btn.getAttribute("data-price") : null;
        if (!value || !PRICE_LABELS[value]) return;
        currentPriceType = value;
        markActive(priceButtons, "price", value);
        updateCalculations();
        renderSelectedTests();
        updateReadyState();
        saveState();
    });

    // Base Package Discount Toggle Button
    if (toggleBaseDiscountBtn) toggleBaseDiscountBtn.addEventListener("click", () => {
        baseDiscountContainer.classList.toggle("hidden");
        if (baseDiscountContainer.classList.contains("hidden")) baseDiscountInput.value = 0;
        updateCalculations();
        saveState();
    });

    if (testSearchInput) testSearchInput.addEventListener("input", handleSearch);
    if (testSearchInput) testSearchInput.addEventListener("keydown", handleSearchKeydown);
    if (baseDiscountInput) baseDiscountInput.addEventListener("input", () => { updateCalculations(); saveState(); });
    if (exportPdfButton) exportPdfButton.addEventListener("click", generateQuotePdfViaPrint);
    if (exportStaffPdfButton) exportStaffPdfButton.addEventListener("click", generateStaffPdfViaPrint);
    if (clearAllBtn) clearAllBtn.addEventListener("click", clearAll);

    // Close the suggestions when clicking outside the search box.
    document.addEventListener("click", (event) => {
        if (!searchResultsDiv) return;
        if (!searchResultsDiv.contains(event.target) && event.target !== testSearchInput) {
            closeSuggestions();
        }
    });

    // --- Search and Selection Logic ---
    function closeSuggestions() {
        if (!searchResultsDiv) return;
        searchResultsDiv.innerHTML = "";
        searchResultsDiv.classList.remove("active");
        currentMatches = [];
        activeIndex = -1;
    }

    function highlightActive() {
        if (!searchResultsDiv) return;
        const items = searchResultsDiv.querySelectorAll("li");
        items.forEach((li, i) => {
            if (i === activeIndex) {
                li.classList.add("active-suggestion");
                li.scrollIntoView({ block: "nearest" });
            } else {
                li.classList.remove("active-suggestion");
            }
        });
    }

    function handleSearch() {
        if (!testSearchInput || !searchResultsDiv) return;
        const rawQuery = testSearchInput.value.trim();
        const query = normalizeForSearch(testSearchInput.value);
        searchResultsDiv.innerHTML = "";
        activeIndex = -1;
        currentMatches = [];
        if (rawQuery.length < 1 || query.length < 1) {
            searchResultsDiv.classList.remove("active");
            return;
        }
        if (!labPrices || labPrices.length === 0) {
            searchResultsDiv.innerHTML = `<p style=\"color: orange;\">מחירי הבדיקות בטעינה או שלא נטענו.</p>`;
            searchResultsDiv.classList.add("active");
            return;
        }
        const filteredTests = labPrices.filter(test =>
            normalizeForSearch(test.test_name).includes(query) ||
            normalizeForSearch(test.test_code).includes(query)
        );
        if (filteredTests.length > 0) {
            currentMatches = filteredTests.slice(0, 15);
            const ul = document.createElement("ul");
            currentMatches.forEach((test, i) => {
                const li = document.createElement("li");
                const price = test.prices ? (test.prices[currentPriceType] || 0) : 0;
                li.innerHTML = formatTestLine(test, formatPrice(price));
                li.addEventListener("click", () => addTestToSelected(test));
                li.addEventListener("mousemove", () => { activeIndex = i; highlightActive(); });
                ul.appendChild(li);
            });
            searchResultsDiv.appendChild(ul);
            searchResultsDiv.classList.add("active");
        } else {
            searchResultsDiv.innerHTML = "<p>לא נמצאו בדיקות תואמות.</p>";
            searchResultsDiv.classList.add("active");
        }
    }

    function handleSearchKeydown(event) {
        if (event.key === "Escape") {
            closeSuggestions();
            return;
        }
        if (!currentMatches.length) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            activeIndex = Math.min(activeIndex + 1, currentMatches.length - 1);
            highlightActive();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlightActive();
        } else if (event.key === "Enter") {
            if (activeIndex >= 0 && activeIndex < currentMatches.length) {
                event.preventDefault();
                addTestToSelected(currentMatches[activeIndex]);
            }
        }
    }

    function addTestToSelected(test) {
        if (!selectedLabTests.find(t => String(t.test_code) === String(test.test_code))) {
            selectedLabTests.push(test);
            renderSelectedTests();
            updateCalculations();
            displayTestDetails(test.test_code);
            saveState();
        }
        if (testSearchInput) testSearchInput.value = "";
        closeSuggestions();
    }

    function removeTestFromSelected(testCode) {
        selectedLabTests = selectedLabTests.filter(t => String(t.test_code) !== String(testCode));
        renderSelectedTests();
        updateCalculations();
        if (testDetailsContentDiv && selectedLabTests.length === 0) {
            testDetailsContentDiv.innerHTML = "<p>בחר בדיקה מהרשימה כדי לראות את פרטיה.</p>";
        } else if (selectedLabTests.length > 0) {
            displayTestDetails(selectedLabTests[selectedLabTests.length -1].test_code);
        } else {
             testDetailsContentDiv.innerHTML = "<p>בחר בדיקה מהרשימה כדי לראות את פרטיה.</p>";
        }
        saveState();
    }

    // Reset selected tests + base discount (branch/price-list settings are kept).
    function clearAll() {
        selectedLabTests = [];
        if (baseDiscountContainer) baseDiscountContainer.classList.add("hidden");
        if (baseDiscountInput) baseDiscountInput.value = 0;
        if (testSearchInput) testSearchInput.value = "";
        closeSuggestions();
        renderSelectedTests();
        updateCalculations();
        if (testDetailsContentDiv) {
            testDetailsContentDiv.innerHTML = "<p>בחר בדיקה מהרשימה כדי לראות את פרטיה.</p>";
        }
        saveState();
    }

    function renderSelectedTests() {
        if (clearAllBtn) clearAllBtn.classList.toggle("hidden", selectedLabTests.length === 0);
        if (!selectedTestsUl) return;
        selectedTestsUl.innerHTML = "";
        selectedLabTests.forEach(test => {
            const li = document.createElement("li");
            const price = test.prices ? (test.prices[currentPriceType] || 0) : 0;
            li.innerHTML = `<span class="selected-test-info" dir="rtl">${formatTestLine(test, formatPrice(price))}</span>`
                + `<button class=\"remove-btn\" data-code=\"${test.test_code}\">הסר</button>`;
            li.addEventListener("click", (e) => {
                if (!e.target.classList.contains("remove-btn")) {
                     displayTestDetails(test.test_code);
                }
            });
            const removeButton = li.querySelector(".remove-btn");
            if (removeButton) {
                removeButton.addEventListener("click", () => removeTestFromSelected(test.test_code));
            }
            selectedTestsUl.appendChild(li);
        });
    }

    function displayTestDetails(testCode) {
        if (!testDetailsContentDiv || !labDetails || !labPrices) return;
        const details = labDetails[String(testCode)];
        const testInfo = labPrices.find(t => String(t.test_code) === String(testCode));
        const testName = testInfo ? testInfo.test_name : "לא ידוע";

        if (details) {
            testDetailsContentDiv.innerHTML = `
                <h4>פרטי בדיקה: ${testName} (${testCode})</h4>
                ${renderDetailRows(details)}
            `;
        } else {
            testDetailsContentDiv.innerHTML = `<p><strong>${testName} (${testCode})</strong></p><p>לא נמצאו פרטים נוספים עבור בדיקה זו.</p>`;
        }
    }

    // --- Calculation Logic ---
    function updateCalculations() {
        // Get current nurse base price
        const currentNursePrice = getCurrentNurseBasePrice();
        if (nurseVisitBasePriceSpan) nurseVisitBasePriceSpan.textContent = formatPrice(currentNursePrice);

        // Apply base package discount
        const baseDiscountVal = baseDiscountInput ? parseFloat(baseDiscountInput.value) : 0;
        const baseDiscountPercent = (baseDiscountContainer && !baseDiscountContainer.classList.contains("hidden") && baseDiscountVal > 0) ? baseDiscountVal : 0;
        const baseDiscountAmount = Math.round((currentNursePrice * baseDiscountPercent) / 100);
        const discountedNursePrice = currentNursePrice - baseDiscountAmount;

        if (summaryNursePriceSpan) summaryNursePriceSpan.textContent = formatPrice(discountedNursePrice);

        // Calculate lab tests total
        let labTestsTotal = 0;
        selectedLabTests.forEach(test => {
            const price = test.prices ? (test.prices[currentPriceType] || 0) : 0;
            labTestsTotal += parseFloat(price) || 0;
        });
        if (labTestsSubtotalSpan) labTestsSubtotalSpan.textContent = formatPrice(labTestsTotal);
        if (summaryLabTestsPriceSpan) summaryLabTestsPriceSpan.textContent = formatPrice(labTestsTotal);

        const finalPrice = discountedNursePrice + labTestsTotal;
        if (finalPriceSpan) finalPriceSpan.textContent = formatPrice(finalPrice);
    }

    function formatPrice(price) {
        if (typeof price !== "number" || isNaN(price)) return "0"; 
        return Math.round(price).toString(); 
    }

    // --- PDF export (offline + mobile) ---
    // The two builders below still produce the exact same print HTML as before.
    // Instead of opening a print window (broken in installed iOS/Android PWAs),
    // we render that HTML in a hidden iframe, rasterize it with html2canvas
    // (keeps Hebrew/RTL pixel-perfect) and assemble a PDF with jsPDF. The file
    // is then shared via the native sheet or opened to save — both fired from a
    // fresh tap so iOS (which requires user activation) allows them.

    async function exportDocHtmlAsPdf(fullHtml, filename) {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.cssText = "position:fixed; top:0; right:-13000px; width:794px; height:1123px; border:0;";
        // A4 width ≈ 794px @ 96dpi. Give the body page-like padding (we no longer
        // have @page margins) without touching the original template strings.
        iframe.srcdoc = fullHtml.replace("</head>", "<style>html,body{margin:0;} body{padding:40px;}</style></head>");
        document.body.appendChild(iframe);
        try {
            await new Promise((resolve) => { iframe.onload = resolve; });
            const idoc = iframe.contentDocument;
            if (idoc.fonts && idoc.fonts.ready) { try { await idoc.fonts.ready; } catch (e) {} }
            await Promise.all(Array.from(idoc.images || []).map(img =>
                img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })));
            const body = idoc.body;
            const canvas = await html2canvas(body, {
                scale: 2, backgroundColor: "#ffffff", useCORS: true,
                width: 794, windowWidth: 794, height: body.scrollHeight
            });
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const imgH = canvas.height * (pageW / canvas.width);
            const imgData = canvas.toDataURL("image/jpeg", 0.92);
            if (imgH <= pageH) {
                pdf.addImage(imgData, "JPEG", 0, 0, pageW, imgH);
            } else {
                // Tall content: lay the one image across pages, shifting it up each page.
                let remaining = imgH, position = 0;
                while (remaining > 0) {
                    pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
                    remaining -= pageH;
                    if (remaining > 0) { pdf.addPage(); position -= pageH; }
                }
            }
            showPdfResult(pdf.output("blob"), filename);
        } finally {
            document.body.removeChild(iframe);
        }
    }

    // Present the finished PDF. Share/open run from a fresh tap so iOS Safari
    // (which requires transient user activation) doesn't block them.
    function showPdfResult(blob, filename) {
        const url = URL.createObjectURL(blob);
        const file = new File([blob], filename, { type: "application/pdf" });
        const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
        const overlay = document.createElement("div");
        overlay.className = "pdf-result-overlay";
        overlay.innerHTML =
            '<div class="pdf-result-card" dir="rtl" role="dialog" aria-label="ייצוא PDF">'
            + '<p class="pdf-result-title">ה-PDF מוכן</p>'
            + (canShare ? '<button type="button" class="pdf-result-btn pdf-share-btn">שתף (וואטסאפ / מייל)</button>' : '')
            + '<button type="button" class="pdf-result-btn pdf-open-btn">פתח / שמור</button>'
            + '<button type="button" class="pdf-result-btn pdf-result-cancel pdf-close-btn">סגור</button>'
            + '</div>';
        document.body.appendChild(overlay);
        const cleanup = () => {
            if (overlay.parentNode) document.body.removeChild(overlay);
            setTimeout(() => URL.revokeObjectURL(url), 3000);
        };
        const shareBtn = overlay.querySelector(".pdf-share-btn");
        if (shareBtn) shareBtn.addEventListener("click", async () => {
            try { await navigator.share({ files: [file], title: filename }); cleanup(); }
            catch (e) { /* cancelled/failed — leave the dialog so another action is possible */ }
        });
        overlay.querySelector(".pdf-open-btn").addEventListener("click", () => { window.open(url, "_blank"); });
        overlay.querySelector(".pdf-close-btn").addEventListener("click", cleanup);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });
    }

    // Run a PDF builder with a busy state on its button + error surfacing.
    async function withPdfButton(btn, build) {
        const original = btn ? btn.textContent : "";
        if (btn) { btn.disabled = true; btn.textContent = "מכין PDF…"; }
        try { await build(); }
        catch (err) {
            console.error("PDF export failed:", err);
            alert("אירעה שגיאה בהפקת ה-PDF. נסה שוב.");
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = original; }
        }
    }

    async function generateQuotePdfViaPrint() {
        const currentDate = new Date().toLocaleDateString("he-IL");
        const logoPath = new URL("assets/logo_final.png", location.href).href;

        // Get current values from the UI for PDF consistency
        const nurseBaseRaw = getCurrentNurseBasePrice();
        const baseDiscountVal = baseDiscountInput ? parseFloat(baseDiscountInput.value) : 0;
        const baseDiscountPercent = (baseDiscountContainer && !baseDiscountContainer.classList.contains("hidden") && baseDiscountVal > 0) ? baseDiscountVal : 0;
        const baseDiscountAmount = Math.round((nurseBaseRaw * baseDiscountPercent) / 100);
        const currentNurseBase = nurseBaseRaw - baseDiscountAmount;

        const labTestsSubtotal = parseFloat(labTestsSubtotalSpan.textContent.replace(/[^\d.-]/g, ""));
        const finalAmountIncludingVat = currentNurseBase + labTestsSubtotal;

        // VAT Calculation
        const amountBeforeVat = Math.round(finalAmountIncludingVat / 1.18);
        const vatAmount = Math.round(finalAmountIncludingVat - amountBeforeVat);

        let testsHtml = selectedLabTests.map(test => {
            const price = test.prices ? (test.prices[currentPriceType] || 0) : 0;
            return `<tr><td>${test.test_code}</td><td>${test.test_name}</td><td>${formatPrice(price)} ש\"ח</td></tr>`;
        }).join("");

        if (selectedLabTests.length === 0) {
            testsHtml = "<tr><td colspan=\"3\">לא נבחרו בדיקות.</td></tr>";
        }

        const quoteHtml = `
            <html>
            <head>
                <title>הצעת מחיר</title>
                <link rel="stylesheet" href="assets/fonts/fonts.css">
                <style>
                    @page { margin: 1.4cm; }
                    * { box-sizing: border-box; }
                    body { direction: rtl; font-family: "Heebo", Arial, sans-serif; color: #0f1230; margin: 0; padding: 0; font-size: 14px; line-height: 1.6; }
                    h1, h2 { font-family: "Frank Ruhl Libre", Georgia, "Times New Roman", serif; }
                    .pdf-header { text-align: center; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 2px solid #c2a14e; }
                    .pdf-header img { max-width: 240px; max-height: 110px; margin-bottom: 8px; }
                    .pdf-header p { margin: 2px 0; font-size: 12px; color: #5b6172; }
                    h1 { text-align: center; color: #03045e; margin: 0 0 4px; font-size: 30px; font-weight: 700; }
                    .quote-details { text-align: center; color: #5b6172; font-size: 13px; margin-bottom: 22px; }
                    .quote-details p { margin: 3px 0; }
                    h2 { color: #03045e; margin: 24px 0 10px; font-size: 18px; font-weight: 700; padding-bottom: 6px; border-bottom: 1px solid #e6e9f0; }
                    p { margin: 5px 0; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
                    th, td { padding: 10px 12px; text-align: right; }
                    thead th { background: #03045e; color: #fff; font-weight: 600; font-size: 13px; }
                    tbody td { border-bottom: 1px solid #e6e9f0; }
                    tbody tr:nth-child(even) { background: #fbfcfe; }
                    .section-summary p { margin: 6px 0; }
                    .section-summary strong { color: #03045e; }
                    .summary-table td { border-bottom: 1px solid #e6e9f0; }
                    .summary-table td:first-child { color: #0f1230; }
                    .summary-table td:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
                    .summary-table strong { color: #03045e; }
                    .total-final td { font-size: 17px; font-weight: 700; color: #03045e; border-top: 2px solid #c2a14e; border-bottom: none; padding-top: 12px; }
                </style>
            </head>
            <body>
                <div class="pdf-header">
                    <img src="${logoPath}" alt="לוגו החברה">
                    <p>טלפון: 3007* / 03-7643939</p>
                    <p>דוא"ל: assutaathome@assuta.co.il</p>
                </div>
                <h1>הצעת מחיר</h1>
                <div class="quote-details">
                    <p>תאריך: ${currentDate}</p>
                </div>
                
                <h2>חבילת בסיס (ביקור אחות, ספירת דם, כימיה בדם)</h2>
                <div class="section-summary">
                    ${baseDiscountPercent > 0 ? `<p>מחיר: ${formatPrice(nurseBaseRaw)} ש\"ח</p><p><strong>לאחר הנחה (${baseDiscountPercent}%): ${formatPrice(currentNurseBase)} ש\"ח</strong></p>` : `<p><strong>מחיר: ${formatPrice(currentNurseBase)} ש\"ח</strong></p>`}
                </div>

                <h2>בדיקות מעבדה נבחרות</h2>
                <table>
                    <thead><tr><th>קוד בדיקה</th><th>שם בדיקה</th><th>מחיר</th></tr></thead>
                    <tbody>${testsHtml}</tbody>
                </table>
                <div class="section-summary">
                    <p><strong>סה\"כ בדיקות: ${formatPrice(labTestsSubtotal)} ש\"ח</strong></p>
                </div>

                <h2>סיכום כללי</h2>
                <table class="summary-table">
                    ${baseDiscountPercent > 0 ? `<tr><td>חבילת בסיס (לפני הנחה):</td><td>${formatPrice(nurseBaseRaw)} ש\"ח</td></tr>
                    <tr><td>הנחה על חבילת בסיס (${baseDiscountPercent}%):</td><td>-${formatPrice(baseDiscountAmount)} ש\"ח</td></tr>
                    <tr><td>חבילת בסיס לאחר הנחה:</td><td>${formatPrice(currentNurseBase)} ש\"ח</td></tr>` : `<tr><td>חבילת בסיס:</td><td>${formatPrice(currentNurseBase)} ש\"ח</td></tr>`}
                    <tr><td>סה\"כ בדיקות מעבדה:</td><td>${formatPrice(labTestsSubtotal)} ש\"ח</td></tr>
                    <tr><td><strong>סה\"כ לפני מע\"מ:</strong></td><td><strong>${formatPrice(amountBeforeVat)} ש\"ח</strong></td></tr>
                    <tr><td>מע"מ (18%):</td><td>${formatPrice(vatAmount)} ש\"ח</td></tr>
                    <tr><td class="total-final"><strong>סכום סופי לתשלום (כולל מע"מ):</strong></td><td class="total-final"><strong>${formatPrice(finalAmountIncludingVat)} ש\"ח</strong></td></tr>
                </table>
            </body>
            </html>
        `;

        await withPdfButton(exportPdfButton, () => exportDocHtmlAsPdf(quoteHtml, "הצעת-מחיר.pdf"));
    }
    
    async function generateStaffPdfViaPrint() {
        const currentDate = new Date().toLocaleDateString("he-IL");
        const logoPath = new URL("assets/logo_final.png", location.href).href;

        let testsDetailsHtml = selectedLabTests.map(test => {
            const details = labDetails[String(test.test_code)];
            if (details) {
                return `
                    <div class="test-item-staff">
                        <h3>${test.test_name} (${test.test_code})</h3>
                        ${renderDetailRows(details)}
                    </div>
                `;
            }
            return `<div class="test-item-staff"><h3>${test.test_name} (${test.test_code})</h3><p>לא נמצאו פרטים נוספים.</p></div>`;
        }).join("");

        if (selectedLabTests.length === 0) {
            testsDetailsHtml = "<p>לא נבחרו בדיקות.</p>";
        }

        const staffPdfHtml = `
            <html>
            <head>
                <title>רשימת בדיקות לצוות</title>
                <link rel="stylesheet" href="assets/fonts/fonts.css">
                <style>
                    @page { margin: 1.4cm; }
                    * { box-sizing: border-box; }
                    body { direction: rtl; font-family: "Heebo", Arial, sans-serif; color: #0f1230; margin: 0; padding: 0; font-size: 14px; line-height: 1.6; }
                    .pdf-header { text-align: center; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 2px solid #c2a14e; }
                    .pdf-header img { max-width: 240px; max-height: 110px; margin-bottom: 8px; }
                    .pdf-header p { margin: 2px 0; font-size: 12px; color: #5b6172; }
                    h1 { text-align: center; color: #03045e; margin: 0 0 6px; font-size: 28px; font-weight: 700; font-family: "Frank Ruhl Libre", Georgia, "Times New Roman", serif; }
                    .quote-details { text-align: center; color: #5b6172; font-size: 13px; margin-bottom: 22px; }
                    .quote-details p { margin: 3px 0; }
                    .test-item-staff { border: 1px solid #e6e9f0; border-right: 3px solid #c2a14e; padding: 16px 18px; margin-bottom: 14px; border-radius: 10px; background: #fbfcfe; page-break-inside: avoid; }
                    .test-item-staff h3 { color: #03045e; margin: 0 0 10px; font-size: 17px; padding-bottom: 8px; border-bottom: 1px solid #e6e9f0; font-family: "Frank Ruhl Libre", Georgia, "Times New Roman", serif; }
                    .test-item-staff p { margin: 5px 0; font-size: 13.5px; color: #5b6172; }
                    .test-item-staff strong { color: #03045e; font-weight: 600; }
                </style>
            </head>
            <body>
                <div class="pdf-header">
                    <img src="${logoPath}" alt="לוגו החברה">
                    <p>טלפון: 3007* / 03-7643939</p>
                    <p>דוא"ל: assutaathome@assuta.co.il</p>
                </div>
                <h1>רשימת בדיקות לצוות</h1>
                <div class="quote-details">
                    <p>תאריך הפקה: ${currentDate}</p>
                </div>
                ${testsDetailsHtml}
            </body>
            </html>
        `;

        await withPdfButton(exportStaffPdfButton, () => exportDocHtmlAsPdf(staffPdfHtml, "רשימת-בדיקות-לצוות.pdf"));
    }

    // --- PWA: offline service worker + install / update prompts ---
    function isStandalone() {
        return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register("./service-worker.js").then((reg) => {
            // Look for a new version when the app regains the foreground. Fails
            // silently offline — the app keeps running from cache, no banner.
            const checkForUpdate = () => { reg.update().catch(() => {}); };
            window.addEventListener("focus", checkForUpdate);
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") checkForUpdate();
            });
            reg.addEventListener("updatefound", () => {
                const sw = reg.installing;
                if (!sw) return;
                sw.addEventListener("statechange", () => {
                    // A new version is ready while the old one still controls the page.
                    if (sw.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(sw);
                });
            });
        }).catch((e) => console.error("SW registration failed:", e));
    }

    function showUpdateBanner(worker) {
        if (document.getElementById("updateBanner")) return;
        const bar = document.createElement("div");
        bar.id = "updateBanner";
        bar.className = "app-banner update-banner";
        bar.innerHTML = '<span>יש גרסה חדשה של האפליקציה.</span>'
            + '<button type="button" id="updateReloadBtn">טען מחדש</button>';
        document.body.appendChild(bar);
        document.getElementById("updateReloadBtn").addEventListener("click", () => {
            navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
            worker.postMessage({ type: "SKIP_WAITING" });
        });
    }

    let deferredInstallPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        showInstallBanner("android");
    });

    function showInstallBanner(kind) {
        if (isStandalone()) return;                                   // already installed
        if (sessionStorage.getItem("installBannerDismissed")) return; // user dismissed this session
        if (document.getElementById("installBanner")) return;
        const bar = document.createElement("div");
        bar.id = "installBanner";
        bar.className = "app-banner install-banner";
        bar.innerHTML = (kind === "android"
            ? '<span>אפשר להתקין את האפליקציה למסך הבית.</span><button type="button" id="installBtn">התקן</button>'
            : '<span>להתקנה: «שיתוף» ⬆️ ואז «הוסף למסך הבית».</span>')
            + '<button type="button" class="banner-close" id="installClose" aria-label="סגור">✕</button>';
        document.body.appendChild(bar);
        const installClose = document.getElementById("installClose");
        if (installClose) installClose.addEventListener("click", () => {
            sessionStorage.setItem("installBannerDismissed", "1");
            bar.remove();
        });
        const installBtn = document.getElementById("installBtn");
        if (installBtn) installBtn.addEventListener("click", async () => {
            bar.remove();
            if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt = null; }
        });
    }

    function maybeShowIosInstallHint() {
        const ua = navigator.userAgent;
        const isIos = /iphone|ipad|ipod/i.test(ua) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+
        const isSafari = /^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua);
        if (isIos && isSafari) showInstallBanner("ios");
    }

    registerServiceWorker();
    maybeShowIosInstallHint();

    // --- Start the application ---
    initializeApp();
});
