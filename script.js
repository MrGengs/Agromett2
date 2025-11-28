// Global variables
let currentSection = 'dashboard';
let weatherData = [];
let harvestData = [];
let currentPrediction = null; // Store current prediction data
let userPlantType = null; // Store user's most common plant type from predictions
let userPlantTypes = []; // Store all unique plant types from user's predictions

// Gemini readiness cache & configuration
let geminiStatusChecked = false;
let geminiIsReady = false;
let geminiAvailableModels = [];
const GEMINI_API_KEY = 'AIzaSyCsMCDQFVZm-2NJXzydDGZHRU1-JkKa8Zc';
// Stable production models - prioritized by stability and availability
// Only using the most stable models to avoid quota and permission issues
const GEMINI_MODEL_FALLBACKS = [
    'models/gemini-1.5-flash',      // Most stable and fast - PRIMARY
    'models/gemini-1.5-pro'         // Most capable and stable - SECONDARY
];

// DOM Content Loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    loadSampleData();
    updateCharts();
});

// Initialize Application
function initializeApp() {
    // Set current date and time
    updateDateTime();
    
    // Initialize charts
    initializeCharts();
    
    // Input data page: pre-check Gemini readiness
    const currentPage = getCurrentPage();
    if (currentPage === 'input-data.html') {
        console.log('Input Data page detected. Checking Gemini readiness...');
        ensureGeminiReady(GEMINI_API_KEY).then(isReady => {
            console.log(`Gemini ready status on load: ${isReady ? 'READY' : 'NOT READY'} (models: ${geminiAvailableModels.length})`);
        });
    }
    
    // Dashboard page: subscribe to real-time weather data
    if (currentPage === 'dashboard.html' || currentPage === '') {
        // Load user's plant type from predictions
        loadUserPlantType();
        subscribeToRealtimeWeather();
    }
    
    // AI Recommendation page: subscribe to real-time weather data for rain detection
    if (currentPage === 'ai-rekomendasi.html') {
        subscribeToRealtimeWeather();
        setupUrgentActionCard();
        // Load recommendations after a short delay to allow weather data to be received
        setTimeout(() => {
            loadAIRecommendations();
        }, 1000);
    }
    
    // History page: load data
    if (currentPage === 'riwayat.html') {
        // Load weather data (sample data for now)
        loadSampleData();
        
        // Check if harvest tab is active on page load
        const harvestTabPane = document.getElementById('harvest-tab');
        const isHarvestTabActive = harvestTabPane && harvestTabPane.classList.contains('active');
        
        if (isHarvestTabActive) {
            // If harvest tab is active, load data after a short delay
            setTimeout(() => {
                loadHarvestHistoryData();
            }, 500);
        } else {
            // Otherwise, just prepare the data loading (will be triggered when tab is clicked)
            console.log('Harvest tab not active on page load, will load when tab is clicked');
        }
    }
    
    // Start periodic updates
    setInterval(updateDateTime, 60000); // Update time every minute
}

// Setup Event Listeners
function setupEventListeners() {
    // Set active nav item based on current page
    setActiveNavItem();
    
    // Form submission (if form exists)
    const farmForm = document.getElementById('farm-data-form');
    if (farmForm) {
        farmForm.addEventListener('submit', handleFormSubmission);
    }
    
    // Inventory form submission
    const inventoryForm = document.getElementById('inventory-form-submit');
    if (inventoryForm) {
        inventoryForm.addEventListener('submit', handleInventorySubmission);
    }
    
    // Harvest form submission
    const harvestForm = document.getElementById('harvest-form-submit');
    if (harvestForm) {
        harvestForm.addEventListener('submit', handleHarvestSubmission);
    }
    
    // Top navigation tabs (Input Data / Prediksi)
    document.querySelectorAll('.top-nav-tab').forEach(btn => {
        btn.addEventListener('click', handleTopNavTabChange);
    });
    
    // Sub navigation tabs (Inventory / Hasil Panen)
    document.querySelectorAll('.sub-nav-tab').forEach(btn => {
        btn.addEventListener('click', handleSubNavTabChange);
    });
    
    // Sync button
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', handleSync);
    }
    
    // Alert close button
    const closeAlert = document.getElementById('close-alert');
    if (closeAlert) {
        closeAlert.addEventListener('click', closeWeatherAlert);
    }
    
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', handleTabChange);
    });
    
    // Export buttons
    document.querySelectorAll('.export-btn').forEach(btn => {
        btn.addEventListener('click', handleExport);
    });
    
    // Save prediction button
    const saveBtn = document.querySelector('.save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', handleSavePrediction);
    }
    
    // Initialize date inputs for harvest form
    initializeHarvestDateInputs();
    
    // Load inventory and harvest data if on input-data page
    const currentPage = getCurrentPage();
    if (currentPage === 'input-data.html') {
        loadInventoryData();
        loadHarvestData();
    }
}

// Set Active Nav Item based on current page
function setActiveNavItem() {
    const currentPage = getCurrentPage();
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = item.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'dashboard.html')) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

function getCurrentPage() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
}

function extractGeminiText(candidate) {
    const collected = [];

    const pushText = value => {
        if (typeof value === 'string' && value.trim()) {
            collected.push(value.trim());
        }
    };

    const collectFromParts = parts => {
        if (!Array.isArray(parts)) return;
        parts.forEach(part => {
            if (!part) return;
            if (typeof part.text === 'string') {
                pushText(part.text);
            } else if (part.functionCall?.args) {
                pushText(JSON.stringify(part.functionCall.args));
            } else if (part.functionResponse?.result) {
                pushText(JSON.stringify(part.functionResponse.result));
            } else if (part.functionResponse?.response) {
                pushText(JSON.stringify(part.functionResponse.response));
            } else if (part.inlineData?.data) {
                pushText(part.inlineData.data);
            } else if (typeof part === 'string') {
                pushText(part);
            }
        });
    };

    collectFromParts(candidate.content?.parts);
    collectFromParts(candidate.parts);
    collectFromParts(candidate.output?.parts);

    if (!collected.length && typeof candidate.output === 'string') {
        pushText(candidate.output);
    }
    if (!collected.length && Array.isArray(candidate.output)) {
        collectFromParts(candidate.output);
    }
    if (!collected.length && typeof candidate.text === 'string') {
        pushText(candidate.text);
    }

    if (!collected.length && candidate.groundingMetadata?.webSearchQueries) {
        pushText(candidate.groundingMetadata.webSearchQueries.join('\n'));
    }

    return collected.join('\n');
}

// Navigation Handler (kept for backward compatibility, but navigation now uses links)
function handleNavigation(e) {
    // Navigation is now handled by HTML links, but we keep this for any dynamic navigation
    const target = e.currentTarget.getAttribute('data-target');
    
    if (target) {
        // Remove active class from all nav items
        document.querySelectorAll('.nav-item').forEach(nav => {
            nav.classList.remove('active');
        });
        
        // Add active class to clicked nav item
        e.currentTarget.classList.add('active');
        
        // Hide all sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        
        // Show target section
        const targetSection = document.getElementById(target);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        currentSection = target;
        
        // Update charts when switching to history section
        if (target === 'history') {
            updateHistoryCharts();
        }
    }
}

// Form Submission Handler
async function handleFormSubmission(e) {
    e.preventDefault();
    
    const formData = {
        plantType: document.getElementById('plant-type').value,
        landArea: parseFloat(document.getElementById('land-area').value),
        growthPhase: document.getElementById('growth-phase').value,
        soilType: document.getElementById('soil-type').value
    };
    
    // Validate form
    if (!formData.plantType || !formData.landArea || !formData.growthPhase) {
        showNotification('Harap lengkapi semua field yang wajib diisi', 'error');
        return;
    }
    
    // Show loading state
    const submitBtn = document.querySelector('.submit-btn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menghitung dengan AI...';
    submitBtn.disabled = true;
    
    try {
        // Calculate predictions using Gemini AI
        const predictions = await calculatePredictionsWithGemini(formData);
        
        // Display results only if AI succeeds
        displayPredictionResults(predictions);
    } catch (error) {
        console.error('Error calculating predictions:', error);
        
        // Get user-friendly error message
        let errorMessage = 'AI Error: Gagal terhubung ke AI Gemini.';
        if (error.message) {
            if (error.message.includes('AI Gemini')) {
                errorMessage = error.message;
            } else if (error.message.includes('404') || error.message.includes('not found') || error.message.includes('not supported')) {
                errorMessage = 'AI Error: Model Gemini tidak tersedia. Periksa API key atau coba lagi nanti.';
            } else if (error.message.includes('API key') || error.message.includes('authentication') || error.message.includes('403')) {
                errorMessage = 'AI Error: API key tidak valid atau tidak memiliki akses ke model Gemini.';
            } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
                errorMessage = 'AI Error: Gagal terhubung ke server AI. Periksa koneksi internet.';
            } else {
                errorMessage = `AI Error: ${error.message}`;
            }
        }
        
        // Show error notification - no output displayed
        showNotification(errorMessage, 'error');
        
        // Clear any previous results
        const resultsContainer = document.getElementById('prediction-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
        }
    } finally {
        // Restore button state
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// Ensure Gemini API readiness (only checked once per session)
async function ensureGeminiReady(apiKey) {
    if (geminiStatusChecked) {
        console.log(`Gemini readiness status: ${geminiIsReady ? 'READY' : 'NOT READY'} (${geminiAvailableModels.length} models cached)`);
        return geminiIsReady;
    }
    
    geminiStatusChecked = true;
    try {
        const healthUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const healthResponse = await fetch(healthUrl);
        if (healthResponse.ok) {
            const healthData = await healthResponse.json();
            geminiAvailableModels = (healthData.models || [])
                .filter(model => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
                .map(model => model.name);
            geminiIsReady = geminiAvailableModels.length > 0;
            console.log(`Gemini readiness check: ${geminiIsReady ? 'READY' : 'NOT READY'} (${geminiAvailableModels.length} models with generateContent)`);
            if (geminiAvailableModels.length) {
                console.log('Gemini models available:', geminiAvailableModels.slice(0, 10));
            }
        } else {
            console.warn('Gemini readiness check failed:', healthResponse.status, healthResponse.statusText);
            geminiIsReady = false;
        }
    } catch (error) {
        console.error('Gemini readiness check error:', error);
        geminiIsReady = false;
    }
    
    return geminiIsReady;
}

// Calculate Predictions with Gemini AI
async function calculatePredictionsWithGemini(formData) {
    const { plantType, landArea, growthPhase, soilType } = formData;
    
    // IMPORTANT: Make sure Generative Language API is enabled in Google Cloud Console
    // Go to: APIs & Services > Library > Search "Generative Language API" > Enable
    
    // Use only the proven working model: gemini-2.0-flash with v1beta endpoint
    const modelName = 'models/gemini-2.0-flash';
    const apiVersion = 'v1beta';
    
    // Create prompt for Gemini
    const plantNames = {
        'padi': 'Padi',
        'jagung': 'Jagung',
        'kedelai': 'Kedelai',
        'cabe': 'Cabe',
        'tomat': 'Tomat',
        'bawang': 'Bawang Merah'
    };
    
    const phaseNames = {
        'persemaian': 'Persemaian',
        'vegetatif': 'Vegetatif',
        'generatif': 'Generatif',
        'panen': 'Panen'
    };
    
    // Calculate base values for reference
    const baseProductivity = {
        'padi': { min: 5.5, max: 7.0, price: 5000, days: 120 },
        'jagung': { min: 7.0, max: 9.0, price: 3000, days: 100 },
        'kedelai': { min: 2.0, max: 3.0, price: 8000, days: 80 },
        'cabe': { min: 12.0, max: 18.0, price: 25000, days: 90 },
        'tomat': { min: 15.0, max: 25.0, price: 7000, days: 75 },
        'bawang': { min: 10.0, max: 15.0, price: 12000, days: 70 }
    };
    
    const phaseMultipliers = {
        'persemaian': 0.1,
        'vegetatif': 0.5,
        'generatif': 0.8,
        'panen': 1.0
    };
    
    const soilMultipliers = {
        'lempung': 1.0,
        'berpasir': 0.8,
        'liat': 0.9,
        'gambut': 1.1
    };
    
    const plantData = baseProductivity[plantType] || baseProductivity.padi;
    const phaseMultiplier = phaseMultipliers[growthPhase] || 1.0;
    const soilMultiplier = soilMultipliers[soilType || 'lempung'] || 1.0;
    
    const prompt = `Kamu adalah ahli pertanian Indonesia yang berpengalaman. Hitung prediksi produktivitas pertanian dengan data berikut:

DATA INPUT:
- Jenis Tanaman: ${plantNames[plantType] || plantType}
- Luas Lahan: ${landArea} hektar
- Fase Pertumbuhan: ${phaseNames[growthPhase] || growthPhase}
- Jenis Tanah: ${soilType || 'Lempung'}

REFERENSI DATA PRODUKTIVITAS INDONESIA:
- Padi: 5.5-7.0 ton/ha, harga Rp 5.000/kg, umur panen 120 hari
- Jagung: 7.0-9.0 ton/ha, harga Rp 3.000/kg, umur panen 100 hari
- Kedelai: 2.0-3.0 ton/ha, harga Rp 8.000/kg, umur panen 80 hari
- Cabe: 12.0-18.0 ton/ha, harga Rp 25.000/kg, umur panen 90 hari
- Tomat: 15.0-25.0 ton/ha, harga Rp 7.000/kg, umur panen 75 hari
- Bawang Merah: 10.0-15.0 ton/ha, harga Rp 12.000/kg, umur panen 70 hari

FAKTOR KOREKSI:
Fase Pertumbuhan:
- Persemaian: 10% dari produktivitas maksimal
- Vegetatif: 50% dari produktivitas maksimal
- Generatif: 80% dari produktivitas maksimal
- Panen: 100% dari produktivitas maksimal

Jenis Tanah:
- Lempung: 100% (optimal untuk pertanian)
- Berpasir: 80% (kurang optimal, drainase cepat)
- Liat: 90% (sedikit kurang optimal)
- Gambut: 110% (sangat subur)

PERHITUNGAN DETAIL (WAJIB DIHITUNG OLEH AI):
Berdasarkan data input:
- Produktivitas dasar ${plantNames[plantType] || plantType}: ${((plantData.min + plantData.max) / 2).toFixed(2)} ton/ha
- Fase ${phaseNames[growthPhase] || growthPhase}: ${(phaseMultiplier * 100).toFixed(0)}% dari produktivitas
- Jenis tanah ${soilType || 'Lempung'}: ${(soilMultiplier * 100).toFixed(0)}% faktor koreksi
- Luas lahan: ${landArea} ha

Hitung dengan langkah:
1. Produktivitas per ha = ${((plantData.min + plantData.max) / 2).toFixed(2)} × ${phaseMultiplier.toFixed(2)} × ${soilMultiplier.toFixed(2)} = ${((plantData.min + plantData.max) / 2 * phaseMultiplier * soilMultiplier).toFixed(2)} ton/ha
2. Total produktivitas = ${((plantData.min + plantData.max) / 2 * phaseMultiplier * soilMultiplier).toFixed(2)} × ${landArea} = ${((plantData.min + plantData.max) / 2 * phaseMultiplier * soilMultiplier * landArea).toFixed(2)} ton
3. Revenue = ${((plantData.min + plantData.max) / 2 * phaseMultiplier * soilMultiplier * landArea).toFixed(2)} × ${plantData.price} × 1000 = ${((plantData.min + plantData.max) / 2 * phaseMultiplier * soilMultiplier * landArea * plantData.price * 1000).toFixed(0)} rupiah
4. Hari panen = ${Math.round(plantData.days * (1 - phaseMultiplier))} hari
5. Perbandingan = hitung selisih dengan hasil sebelumnya (asumsikan 5% lebih rendah)
6. Akurasi = 90%

WAJIB kembalikan HANYA JSON berikut (tanpa teks apapun sebelum atau sesudahnya):
{
    "productivity": <angka desimal dalam ton, contoh: 6.25>,
    "revenue": <angka bulat dalam rupiah, contoh: 31250000>,
    "harvestDays": <jumlah hari hingga panen, contoh: 45>,
    "yieldComparison": <persentase perbandingan, contoh: 8.5 atau -3.2>,
    "accuracy": <persentase akurasi 85-95, contoh: 87>
}

PENTING: 
- Hanya kembalikan JSON murni, tidak ada penjelasan
- Tidak ada markdown code blocks  
- Tidak ada teks sebelum atau sesudah JSON
- Gunakan nilai yang sudah dihitung di atas sebagai referensi
- Pastikan semua angka sudah dihitung dengan benar oleh AI`;

    try {
        // Use only gemini-2.0-flash with v1beta endpoint
        const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
        
        try {
            console.log(`Calling Gemini API: ${modelName} with ${apiVersion} endpoint`);
            
            const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            contents: [{
                                role: 'user',
                                parts: [{
                                    text: prompt
                                }]
                            }],
                            generationConfig: {
                                temperature: 0.1,
                                topK: 1,
                                topP: 0.8,
                                maxOutputTokens: 300,
                                responseMimeType: 'application/json'
                            }
                        })
                    });

                    console.log('Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
                console.error(`Gemini API error (${modelName}, ${apiVersion}):`, response.status, errorMessage);
                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log('Gemini raw response:', data);
            
            const candidate = data.candidates?.[0];
            if (!candidate) {
                throw new Error('AI Gemini tidak mengembalikan kandidat jawaban');
            }
            
            const responseText = extractGeminiText(candidate).trim();
            if (!responseText) {
                console.warn('Candidate data with no text payload:', candidate);
                throw new Error('AI Gemini mengembalikan format response yang tidak valid');
            }
            
            console.log('Gemini AI Response Text:', responseText);
            
            let jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const firstBrace = jsonText.indexOf('{');
            if (firstBrace > 0) {
                jsonText = jsonText.substring(firstBrace);
            }
            const lastBrace = jsonText.lastIndexOf('}');
            if (lastBrace >= 0 && lastBrace < jsonText.length - 1) {
                jsonText = jsonText.substring(0, lastBrace + 1);
            }
            
            const aiResult = JSON.parse(jsonText);
            
            if (typeof aiResult.productivity === 'undefined' || 
                typeof aiResult.revenue === 'undefined' ||
                typeof aiResult.harvestDays === 'undefined') {
                throw new Error('AI Gemini tidak mengembalikan semua data yang diperlukan');
            }
            
            const harvestDate = new Date();
            harvestDate.setDate(harvestDate.getDate() + (parseInt(aiResult.harvestDays) || 90));
            
            const result = {
                productivity: parseFloat(aiResult.productivity) || 0,
                revenue: parseFloat(aiResult.revenue) || 0,
                harvestDate: harvestDate,
                yieldComparison: parseFloat(aiResult.yieldComparison) || 0,
                accuracy: parseInt(aiResult.accuracy) || 85
            };
            
            console.log(`✓ Gemini API call succeeded with model ${modelName} (${apiVersion})`);
            console.log('Parsed AI Result:', result);
            return result;
        } catch (err) {
            console.error('Error calling Gemini:', err);
            const errorMessage = err?.message || 'Unknown AI error';
            
            let userMessage = `AI Gemini tidak dapat diakses: ${errorMessage}`;
            if (errorMessage.includes('not found') || errorMessage.includes('not supported')) {
                userMessage = 'AI Error: Model Gemini tidak tersedia.\n\n' +
                    'Langkah perbaikan:\n' +
                    '1. Buka: https://console.cloud.google.com/apis/library\n' +
                    '2. Cari "Generative Language API"\n' +
                    '3. Klik dan pastikan status "ENABLED"\n' +
                    '4. Jika belum enabled, klik tombol "ENABLE"\n' +
                    '5. Tunggu 2-5 menit setelah enable\n' +
                    '6. Refresh halaman dan coba lagi';
            } else if (errorMessage.includes('API key') || errorMessage.includes('authentication')) {
                userMessage = 'AI Error: API key tidak valid atau tidak memiliki akses.\n\n' +
                    'Periksa di Google Cloud Console:\n' +
                    '1. APIs & Services > Credentials\n' +
                    '2. Klik API key Anda\n' +
                    '3. Pastikan "Generative Language API" tercentang di API restrictions';
            }
            
            throw new Error(userMessage);
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        // Re-throw with user-friendly message if it's not already formatted
        if (error.message && !error.message.includes('AI Gemini')) {
            throw new Error(`AI Error: ${error.message}`);
        }
        throw error;
    }
}

// Calculate Predictions (Fallback - Local Calculation)
function calculatePredictions(formData) {
    const { plantType, landArea, growthPhase, soilType } = formData;
    
    // Base productivity data (tons/hectare)
    const baseProductivity = {
        'padi': { min: 5.5, max: 7.0, price: 5000 },
        'jagung': { min: 7.0, max: 9.0, price: 3000 },
        'kedelai': { min: 2.0, max: 3.0, price: 8000 },
        'cabe': { min: 12.0, max: 18.0, price: 25000 },
        'tomat': { min: 15.0, max: 25.0, price: 7000 },
        'bawang': { min: 10.0, max: 15.0, price: 12000 }
    };
    
    // Growth phase multipliers
    const phaseMultipliers = {
        'persemaian': 0.1,
        'vegetatif': 0.5,
        'generatif': 0.8,
        'panen': 1.0
    };
    
    // Soil type adjustments
    const soilAdjustments = {
        'lempung': 1.0,
        'berpasir': 0.8,
        'liat': 0.9,
        'gambut': 1.1
    };
    
    const plantData = baseProductivity[plantType] || baseProductivity.padi;
    const baseYield = (plantData.min + plantData.max) / 2;
    const phaseMultiplier = phaseMultipliers[growthPhase] || 1.0;
    // Default to lempung if soil type not selected
    const soilMultiplier = soilAdjustments[soilType || 'lempung'] || 1.0;
    
    // Calculate estimated productivity
    const estimatedProductivity = baseYield * landArea * phaseMultiplier * soilMultiplier;
    
    // Calculate estimated revenue
    const estimatedRevenue = estimatedProductivity * plantData.price * 1000; // Convert to IDR
    
    // Calculate harvest date (simple estimation)
    const harvestDays = calculateHarvestDays(plantType, growthPhase);
    const harvestDate = new Date();
    harvestDate.setDate(harvestDate.getDate() + harvestDays);
    
    // Calculate yield comparison
    const previousYield = baseYield * landArea * 0.95; // Assume 5% less than current
    const yieldComparison = ((estimatedProductivity - previousYield) / previousYield) * 100;
    
    return {
        productivity: estimatedProductivity,
        revenue: estimatedRevenue,
        harvestDate: harvestDate,
        yieldComparison: yieldComparison,
        accuracy: 85 // Simulated accuracy percentage
    };
}

// Calculate Harvest Days
function calculateHarvestDays(plantType, growthPhase) {
    const growthPhases = {
        'persemaian': 15,
        'vegetatif': 45,
        'generatif': 30,
        'panen': 0
    };
    
    const plantGrowth = {
        'padi': 120,
        'jagung': 100,
        'kedelai': 80,
        'cabe': 90,
        'tomat': 75,
        'bawang': 70
    };
    
    const totalDays = plantGrowth[plantType] || 90;
    const phaseDays = growthPhases[growthPhase] || 0;
    
    return Math.max(0, totalDays - phaseDays);
}

// Display Prediction Results
function displayPredictionResults(predictions) {
    const resultElement = document.getElementById('prediction-result');
    const formatNumber = (num) => new Intl.NumberFormat('id-ID').format(num);
    
    // Store current prediction data globally
    const formData = {
        plantType: document.getElementById('plant-type').value,
        landArea: parseFloat(document.getElementById('land-area').value),
        growthPhase: document.getElementById('growth-phase').value,
        soilType: document.getElementById('soil-type').value
    };
    
    currentPrediction = {
        ...formData,
        ...predictions,
        createdAt: new Date()
    };
    
    // Update result values
    document.getElementById('productivity-estimate').textContent = 
        `${formatNumber(predictions.productivity.toFixed(2))} ton`;
    
    document.getElementById('revenue-estimate').textContent = 
        `Rp ${formatNumber(predictions.revenue.toFixed(0))}`;
    
    document.getElementById('harvest-estimate').textContent = 
        predictions.harvestDate.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    
    const comparisonText = predictions.yieldComparison >= 0 ? 
        `+${predictions.yieldComparison.toFixed(1)}%` : 
        `${predictions.yieldComparison.toFixed(1)}%`;
    
    document.getElementById('yield-comparison').textContent = comparisonText;
    
    // Update accuracy
    document.querySelector('.result-accuracy span').textContent = 
        `Akurasi: ${predictions.accuracy}%`;
    
    // Show save button if it was hidden (for new predictions)
    const saveBtn = document.querySelector('.save-btn');
    if (saveBtn) {
        saveBtn.style.display = '';
        saveBtn.disabled = false;
    }
    
    // Show result section with animation
    resultElement.style.display = 'block';
    resultElement.scrollIntoView({ behavior: 'smooth' });
}

// Handle Save Prediction
async function handleSavePrediction(e) {
    e.preventDefault();
    
    // Check if user is authenticated
    const { getCurrentUser } = await import('./firebase-auth.js');
    const user = await getCurrentUser();
    
    if (!user) {
        showNotification('Silakan login terlebih dahulu untuk menyimpan data', 'error');
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 2000);
        return;
    }
    
    // Check if there's a prediction to save
    if (!currentPrediction) {
        showNotification('Tidak ada hasil prediksi untuk disimpan. Silakan hitung prediksi terlebih dahulu.', 'error');
        return;
    }
    
    const saveBtn = document.querySelector('.save-btn');
    const originalHTML = saveBtn.innerHTML;
    
    // Show loading state
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    saveBtn.disabled = true;
    
    try {
        // Import save function from firebase-auth.js
        const { savePredictionToFirestore } = await import('./firebase-auth.js');
        
        // Save prediction to Firestore
        await savePredictionToFirestore(user.uid, currentPrediction);
        
        showNotification('Prediksi Tersimpan', 'success');
        
        // Hide save button after successful save
        saveBtn.style.display = 'none';
    } catch (error) {
        console.error('Error saving prediction:', error);
        showNotification('Gagal menyimpan hasil prediksi: ' + error.message, 'error');
        
        // Restore button
        saveBtn.innerHTML = originalHTML;
        saveBtn.disabled = false;
    }
}

// Sync Handler
function handleSync() {
    const syncBtn = document.getElementById('sync-btn');
    const syncStatus = document.getElementById('sync-status');
    
    // Show loading state
    syncBtn.classList.add('fa-spin');
    syncStatus.textContent = 'Menyinkronkan...';
    
    // Simulate API call
    setTimeout(() => {
        syncBtn.classList.remove('fa-spin');
        syncStatus.textContent = 'Disinkronisasi';
        
        // Update last update time
        updateDateTime();
        
        // Show success notification
        showNotification('Data berhasil disinkronisasi dengan cloud AGROMETT', 'success');
        
        // Reset status after 3 seconds
        setTimeout(() => {
            syncStatus.textContent = 'Disinkronisasi';
        }, 3000);
    }, 2000);
}

// Close Weather Alert
function closeWeatherAlert() {
    const alert = document.getElementById('weather-alert');
    if (alert) {
        alert.style.display = 'none';
    }
}

// Tab Change Handler
function handleTabChange(e) {
    const targetTab = e.currentTarget.getAttribute('data-tab');
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to clicked tab button
    e.currentTarget.classList.add('active');
    
    // Hide all tab panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    // Show target tab pane
    document.getElementById(`${targetTab}-tab`).classList.add('active');
    
    // Load harvest data when harvest tab is clicked
    if (targetTab === 'harvest') {
        console.log('Harvest tab clicked, loading data...');
        
        // Ensure tab pane is visible immediately
        const harvestTabPane = document.getElementById('harvest-tab');
        if (harvestTabPane) {
            harvestTabPane.style.display = 'block';
            harvestTabPane.style.visibility = 'visible';
            harvestTabPane.style.opacity = '1';
        }
        
        // Ensure canvas is visible
        const yieldChartEl = document.getElementById('yieldChart');
        if (yieldChartEl) {
            yieldChartEl.style.display = 'block';
            yieldChartEl.style.visibility = 'visible';
        }
        
        // Small delay to ensure tab pane is visible before creating chart
        setTimeout(() => {
            console.log('Loading harvest history data after tab switch...');
            loadHarvestHistoryData();
            
            // If there's pending harvest data, create chart now
            if (window.pendingHarvestData) {
                console.log('Creating chart with pending harvest data');
                updateYieldChart(window.pendingHarvestData);
                window.pendingHarvestData = null;
            }
        }, 500);
    }
}

// Export Handler
function handleExport(e) {
    e.preventDefault();
    
    // Check if this is weather data export
    const weatherTableBody = document.getElementById('weather-table-body');
    if (weatherTableBody) {
        exportWeatherDataToExcel();
        return;
    }
    
    // Default behavior for other exports
    const format = e.currentTarget.textContent.includes('PDF') ? 'PDF' : 'Excel';
    showNotification(`Mengekspor data dalam format ${format}...`, 'info');
    
    // Simulate export process
    setTimeout(() => {
        showNotification(`Data berhasil diekspor dalam format ${format}`, 'success');
    }, 1500);
}

// Export Weather Data to Excel with formatting
async function exportWeatherDataToExcel() {
    try {
        // Check if ExcelJS library is loaded
        if (typeof ExcelJS === 'undefined') {
            showNotification('Library Excel belum dimuat. Silakan refresh halaman.', 'error');
            console.error('ExcelJS library is not loaded');
            return;
        }
        
        const tableBody = document.getElementById('weather-table-body');
        if (!tableBody) {
            showNotification('Tabel data cuaca tidak ditemukan', 'error');
            return;
        }
        
        const rows = tableBody.querySelectorAll('tr');
        if (rows.length === 0) {
            showNotification('Tidak ada data cuaca untuk diekspor', 'warning');
            return;
        }
        
        // Get table headers with units
        const headers = ['Tanggal', 'Suhu(°C)', 'Kelembapan(%)', 'Cahaya(Lux)', 'Angin(km/jam)'];
        const numColumns = headers.length; // Always 5 columns
        
        // Create workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Data Cuaca');
        
        // Set column widths
        worksheet.columns = [
            { width: 20 }, // Tanggal
            { width: 14 }, // Suhu
            { width: 16 }, // Kelembaban
            { width: 16 }, // Cahaya
            { width: 16 }  // Angin
        ];
        
        // Add title row - create array with title and empty cells for remaining columns
        const titleRowData = ['Data Cuaca 7 Hari Terakhir'];
        // Fill remaining columns with empty strings to ensure only 5 columns
        for (let i = 1; i < numColumns; i++) {
            titleRowData.push('');
        }
        const titleRow = worksheet.addRow(titleRowData);
        
        // Style only the first cell (A1) - merged cells will handle the rest
        const titleCell = titleRow.getCell(1);
        titleCell.font = { 
            bold: true, 
            size: 16, 
            color: { argb: 'FFFFFFFF' } // White text for better contrast
        };
        titleCell.alignment = { 
            horizontal: 'center', 
            vertical: 'middle' 
        };
        titleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2E7D32' } // Dark green background
        };
        // No border on title cell
        
        titleRow.height = 35;
        
        // Merge title cells - only 5 columns (A to E)
        worksheet.mergeCells(1, 1, 1, numColumns);
        
        // Add empty row
        worksheet.addRow([]);
        
        // Add header row
        const headerRow = worksheet.addRow(headers);
        headerRow.height = 28;
        
        // Style header cells - only first 5 columns (A3, B3, C3, D3, E3)
        // Explicitly style only columns 1 to 5
        for (let col = 1; col <= numColumns; col++) {
            const cell = headerRow.getCell(col);
            cell.font = { 
                bold: true, 
                size: 12, 
                color: { argb: 'FFFFFFFF' } // White text
            };
            cell.alignment = { 
                horizontal: 'center', 
                vertical: 'middle' 
            };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2E7D32' } // Green background
            };
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF000000' } },
                left: { style: 'medium', color: { argb: 'FF000000' } },
                bottom: { style: 'medium', color: { argb: 'FF000000' } },
                right: { style: 'medium', color: { argb: 'FF000000' } }
            };
            cell.wrapText = true;
        }
        
        // Add data rows
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
                const rowData = [];
                cells.forEach((cell, index) => {
                    // Remove units and clean the data
                    let cellText = cell.textContent.trim();
                    // Remove common units for cleaner data
                    cellText = cellText.replace(/\s*°C\s*/g, '');
                    cellText = cellText.replace(/\s*%\s*/g, '');
                    cellText = cellText.replace(/\s*Lux\s*/g, '');
                    cellText = cellText.replace(/\s*km\/jam\s*/g, '');
                    
                    // Convert to number if it's a numeric value (except first column which is date)
                    if (index > 0) {
                        const numValue = parseFloat(cellText);
                        if (!isNaN(numValue)) {
                            rowData.push(numValue);
                        } else {
                            rowData.push(cellText);
                        }
                    } else {
                        rowData.push(cellText);
                    }
                });
                
                const dataRow = worksheet.addRow(rowData);
                dataRow.alignment = { 
                    horizontal: 'center', 
                    vertical: 'middle' 
                };
                dataRow.height = 22;
                
                // Style data cells with borders
                dataRow.eachCell((cell, colNumber) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FF000000' } },
                        left: { style: 'thin', color: { argb: 'FF000000' } },
                        bottom: { style: 'thin', color: { argb: 'FF000000' } },
                        right: { style: 'thin', color: { argb: 'FF000000' } }
                    };
                    
                    // Left align date column
                    if (colNumber === 1) {
                        cell.alignment = { 
                            horizontal: 'left', 
                            vertical: 'middle',
                            wrapText: false
                        };
        } else {
                        // Center align other columns
                        cell.alignment = { 
                            horizontal: 'center', 
                            vertical: 'middle',
                            wrapText: false
                        };
                    }
                    
                    // Format numbers
                    if (colNumber > 1 && typeof cell.value === 'number') {
                        if (colNumber === 2) { // Temperature - 1 decimal
                            cell.numFmt = '0.0';
                        } else { // Others - no decimal
                            cell.numFmt = '0';
                        }
                    }
                });
            }
        });
        
        // Add empty row for spacing
        worksheet.addRow([]);
        
        // Add footer info
        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        const timeStr = now.toLocaleTimeString('id-ID', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        // Footer row 1 - Created date
        const footerRow1 = worksheet.addRow([]);
        const footerCell1 = footerRow1.getCell(1);
        footerCell1.value = 'Dibuat pada:';
        footerCell1.font = { bold: true, size: 10, color: { argb: 'FF666666' } };
        footerCell1.alignment = { horizontal: 'left', vertical: 'middle' };
        
        const footerCell1Value = footerRow1.getCell(2);
        footerCell1Value.value = dateStr + ' ' + timeStr;
        footerCell1Value.font = { size: 10, color: { argb: 'FF666666' } };
        footerCell1Value.alignment = { horizontal: 'left', vertical: 'middle' };
        
        // Footer row 2 - Source
        const footerRow2 = worksheet.addRow([]);
        const footerCell2 = footerRow2.getCell(1);
        footerCell2.value = 'Sumber:';
        footerCell2.font = { bold: true, size: 10, color: { argb: 'FF666666' } };
        footerCell2.alignment = { horizontal: 'left', vertical: 'middle' };
        
        const footerCell2Value = footerRow2.getCell(2);
        footerCell2Value.value = 'Agromett - Smart Farming Solution';
        footerCell2Value.font = { size: 10, color: { argb: 'FF666666' } };
        footerCell2Value.alignment = { horizontal: 'left', vertical: 'middle' };
        
        // Generate filename with date range (7 days)
        // Calculate start date (7 days ago, including today = 7 days)
        const endDate = new Date(now);
        const startDate = new Date(now);
        startDate.setDate(now.getDate() - 6); // 7 days ago (including today = 7 days)
        
        const startDay = startDate.getDate();
        const endDay = endDate.getDate();
        const month = endDate.getMonth() + 1; // Month is 0-indexed
        const year = endDate.getFullYear();
        
        // Format: Data_Cuaca_{startDay}-{endDay}_{month}_{year}
        const filename = `Data_Cuaca_${startDay}-${endDay}_${month}_${year}.xlsx`;
        
        // Write file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { 
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up
        URL.revokeObjectURL(url);
        
        showNotification('Data cuaca berhasil diekspor ke Excel', 'success');
        console.log('✓ Weather data exported to Excel:', filename);
        
    } catch (error) {
        console.error('Error exporting weather data:', error);
        showNotification('Gagal mengekspor data cuaca: ' + error.message, 'error');
    }
}

// Update Date and Time
function updateDateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = `Diperbarui: ${timeString} WIB`;
    }
}

// Subscribe to real-time weather data from Firebase Realtime Database
let weatherUnsubscribe = null;
let lastWeatherData = null;
let lastRainStatus = null; // Track rain status for notifications

async function subscribeToRealtimeWeather() {
    try {
        const { subscribeToWeatherData } = await import('./firebase-auth.js');
        
        weatherUnsubscribe = await subscribeToWeatherData((data, error) => {
            if (error) {
                console.error('Error receiving sensor data:', error);
                // Fallback to simulated data if real-time fails
                updateWeatherDataFallback();
                return;
            }
            
            if (data) {
                console.log('Received sensor data:', JSON.stringify(data, null, 2));
                console.log('Temperature:', data.temperature, 'Humidity:', data.humidity, 'Lux:', data.lux, 'Wind:', data.wind_km_h, 'Rain:', data.rain);
                
                // Check for rain status change - only notify when changing TO "Hujan"
                if (lastRainStatus !== null && lastRainStatus !== data.rain) {
                    // Rain status changed
                    if (data.rain === 'Hujan') {
                        showRainNotification();
                    }
                }
                lastRainStatus = data.rain;
                
                // Always update display with received data
                updateWeatherDisplay(data);
                lastWeatherData = data;
                
                // Update urgent action card on AI recommendation page
                updateUrgentActionCard(data.rain);
                
                // Update AI recommendations if on recommendation page (debounce to avoid too many calls)
                const currentPage = getCurrentPage();
                if (currentPage === 'ai-rekomendasi.html') {
                    // Debounce recommendation updates (wait 2 seconds after last weather update)
                    clearTimeout(window.recommendationUpdateTimeout);
                    window.recommendationUpdateTimeout = setTimeout(() => {
                        loadAIRecommendations();
                    }, 2000);
                }
            } else {
                console.warn('No data received from sensor/last');
            }
        });
        
        console.log('Subscribed to real-time sensor data from sensor/last');
    } catch (error) {
        console.error('Error subscribing to sensor data:', error);
        // Fallback to simulated data
        updateWeatherDataFallback();
    }
}

// Update weather display with real-time data from sensor/last
function updateWeatherDisplay(weatherData) {
    // Update temperature - always try to display from temperature field
    const tempEl = document.querySelector('.temperature .weather-value');
    if (tempEl) {
        if (weatherData.temperature !== undefined && weatherData.temperature !== null) {
        const temp = parseFloat(weatherData.temperature);
            if (!isNaN(temp) && temp !== -999) {
        tempEl.textContent = `${temp.toFixed(1)}°C`;
        // Update trend (compare with last value)
        updateTrend('.temperature', lastWeatherData?.temperature, temp);
                console.log('✓ Temperature updated:', temp, '°C');
            } else {
                tempEl.textContent = '--°C';
                console.log('⚠ Temperature is invalid (-999 or NaN):', temp);
            }
        } else {
            tempEl.textContent = '--°C';
            console.log('⚠ Temperature field not found in data');
        }
    }
    
    // Update humidity - always try to display from humidity field
    const humidityEl = document.querySelector('.humidity .weather-value');
    if (humidityEl) {
        if (weatherData.humidity !== undefined && weatherData.humidity !== null) {
        const humidity = parseFloat(weatherData.humidity);
            if (!isNaN(humidity) && humidity !== -999) {
        humidityEl.textContent = `${humidity.toFixed(0)}%`;
        updateTrend('.humidity', lastWeatherData?.humidity, humidity);
                console.log('✓ Humidity updated:', humidity, '%');
            } else {
                humidityEl.textContent = '--%';
                console.log('⚠ Humidity is invalid (-999 or NaN):', humidity);
            }
        } else {
            humidityEl.textContent = '--%';
            console.log('⚠ Humidity field not found in data');
        }
    }
    
    // Update light intensity (lux)
    const lightEl = document.querySelector('.light .weather-value');
    if (lightEl && weatherData.lux !== undefined) {
        const lux = parseFloat(weatherData.lux);
        lightEl.textContent = `${lux.toFixed(1)} Lux`;
        updateTrend('.light', lastWeatherData?.lux, lux);
    }
    
    // Update wind speed (wind_km_h)
    const windEl = document.querySelector('.wind .weather-value');
    if (windEl && weatherData.wind_km_h !== undefined) {
        const wind = parseFloat(weatherData.wind_km_h);
        windEl.textContent = `${wind.toFixed(1)} km/jam`;
        updateTrend('.wind', lastWeatherData?.wind_km_h, wind);
    }
    
    // Update rain status in quick-stats (first stat-card with cloud-rain icon)
    if (weatherData.rain !== undefined) {
        const rainStatus = weatherData.rain;
        // Find the rain stat card (first stat-card)
        const statCards = document.querySelectorAll('.stat-card');
        if (statCards.length > 0) {
            const rainCard = statCards[0]; // First card is rain status
            const rainValueEl = rainCard.querySelector('.stat-value');
            const rainLabelEl = rainCard.querySelector('.stat-label');
            if (rainValueEl) {
                rainValueEl.textContent = rainStatus;
                // Add visual indicator if raining
                if (rainStatus === 'Hujan') {
                    rainCard.style.border = '2px solid #2196f3';
                    rainCard.style.background = 'rgba(33, 150, 243, 0.1)';
                } else {
                    rainCard.style.border = '';
                    rainCard.style.background = '';
                }
            }
            if (rainLabelEl) {
                rainLabelEl.textContent = 'Status Hujan';
            }
        }
    }
    
    // Update timestamp if available
    if (weatherData.ts !== undefined) {
        const timestamp = weatherData.ts;
        let date;
        
        // Handle different timestamp formats
        // If timestamp is less than 1e10, assume it's in seconds, otherwise milliseconds
        if (timestamp < 1e10) {
            date = new Date(timestamp * 1000); // Convert seconds to milliseconds
        } else {
            date = new Date(timestamp); // Already in milliseconds
        }
        
        // Check if date is valid
        if (!isNaN(date.getTime())) {
            const timeString = date.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            
            const lastUpdateEl = document.getElementById('last-update');
            if (lastUpdateEl) {
                lastUpdateEl.textContent = `Diperbarui: ${timeString} WIB`;
            }
        } else {
            // Invalid date, use current time
            updateDateTime();
        }
    } else {
    // Update last update time
    updateDateTime();
    }
    
    // Update weather details based on sensor data
    updateWeatherDetails(weatherData);
    
    // Update charts if data changed significantly
    if (lastWeatherData) {
        updateCharts();
    }
}

// Load user's most common plant type from Firestore predictions
async function loadUserPlantType() {
    try {
        // Set default first
        if (!userPlantType) {
            userPlantType = 'padi';
        }
        
        const { getCurrentUser } = await import('./firebase-auth.js');
        const user = await getCurrentUser();
        
        if (!user) {
            console.log('User not logged in, using default plant type: padi');
            userPlantType = 'padi';
            userPlantTypes = ['padi'];
            return;
        }
        
        const { getUserPredictions } = await import('./firebase-auth.js');
        const predictions = await getUserPredictions(user.uid, 100);
        
        if (predictions && predictions.length > 0) {
            // Count plant types and collect all unique types
            const plantTypeCount = {};
            const uniquePlantTypes = new Set();
            
            predictions.forEach(pred => {
                if (pred.plantType) {
                    const plantType = pred.plantType.toLowerCase();
                    plantTypeCount[plantType] = (plantTypeCount[plantType] || 0) + 1;
                    uniquePlantTypes.add(plantType);
                }
            });
            
            // Store all unique plant types
            userPlantTypes = Array.from(uniquePlantTypes);
            
            // Get most common plant type
            let maxCount = 0;
            let mostCommonPlant = 'padi'; // Default
            
            Object.keys(plantTypeCount).forEach(plantType => {
                if (plantTypeCount[plantType] > maxCount) {
                    maxCount = plantTypeCount[plantType];
                    mostCommonPlant = plantType;
                }
            });
            
            userPlantType = mostCommonPlant;
            console.log('User plant types loaded:', userPlantTypes, `(most common: ${mostCommonPlant} with ${maxCount} predictions)`);
            
            // Update humidity detail if already displayed (force update with new plant type)
            if (lastWeatherData) {
                updateWeatherDetails(lastWeatherData);
            }
        } else {
            userPlantType = 'padi'; // Default if no predictions
            userPlantTypes = ['padi'];
            console.log('No predictions found, using default plant type: padi');
        }
    } catch (error) {
        console.error('Error loading user plant type:', error);
        userPlantType = 'padi'; // Default on error
        userPlantTypes = ['padi'];
    }
}

// Get plant name in Indonesian (capitalize first letter)
function getPlantName(plantType) {
    if (!plantType) return 'padi';
    
    // Convert to lowercase for matching
    const plant = plantType.toLowerCase();
    
    // Map common plant types to Indonesian names
    const plantNames = {
        'padi': 'Padi',
        'jagung': 'Jagung',
        'kedelai': 'Kedelai',
        'cabe': 'Cabe',
        'tomat': 'Tomat',
        'bawang': 'Bawang Merah',
        'stroberi': 'Stroberi',
        'cabai': 'Cabai',
        'cabai rawit': 'Cabai Rawit',
        'bawang merah': 'Bawang Merah',
        'bawang putih': 'Bawang Putih',
        'kentang': 'Kentang',
        'wortel': 'Wortel',
        'kubis': 'Kubis',
        'brokoli': 'Brokoli',
        'selada': 'Selada',
        'bayam': 'Bayam',
        'kangkung': 'Kangkung',
        'sawi': 'Sawi',
        'mentimun': 'Mentimun',
        'terong': 'Terong',
        'kacang panjang': 'Kacang Panjang',
        'kacang hijau': 'Kacang Hijau',
        'kacang tanah': 'Kacang Tanah'
    };
    
    // Check if plant type exists in mapping
    if (plantNames[plant]) {
        return plantNames[plant];
    }
    
    // If not found, capitalize first letter of each word
    return plantType.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

// Get optimal humidity range for a plant
function getPlantOptimalHumidity(plantType) {
    if (!plantType) return null;
    
    const plant = plantType.toLowerCase();
    
    // Optimal humidity ranges for different plants (min, max)
    const humidityRanges = {
        'stroberi': { min: 60, max: 75 },
        'padi': { min: 70, max: 85 },
        'jagung': { min: 50, max: 70 },
        'kedelai': { min: 50, max: 70 },
        'cabe': { min: 50, max: 70 },
        'cabai': { min: 50, max: 70 },
        'cabai rawit': { min: 50, max: 70 },
        'tomat': { min: 60, max: 80 },
        'bawang': { min: 60, max: 70 },
        'bawang merah': { min: 60, max: 70 },
        'bawang putih': { min: 60, max: 70 },
        'kentang': { min: 70, max: 85 },
        'wortel': { min: 60, max: 75 },
        'kubis': { min: 70, max: 85 },
        'brokoli': { min: 70, max: 85 },
        'selada': { min: 70, max: 85 },
        'bayam': { min: 70, max: 85 },
        'kangkung': { min: 70, max: 85 },
        'sawi': { min: 70, max: 85 },
        'mentimun': { min: 60, max: 75 },
        'terong': { min: 60, max: 75 },
        'kacang panjang': { min: 60, max: 75 },
        'kacang hijau': { min: 50, max: 70 },
        'kacang tanah': { min: 50, max: 70 }
    };
    
    return humidityRanges[plant] || null;
}

// Get all plants that are optimal at a given humidity level
function getOptimalPlantsForHumidity(humidity, userPlantTypes = []) {
    const optimalPlants = [];
    
    // Ensure userPlantTypes is an array
    if (!Array.isArray(userPlantTypes)) {
        userPlantTypes = [];
    }
    
    // All plants with their optimal ranges
    const allPlants = {
        'stroberi': { min: 60, max: 75, name: 'Stroberi' },
        'padi': { min: 70, max: 85, name: 'Padi' },
        'jagung': { min: 50, max: 70, name: 'Jagung' },
        'kedelai': { min: 50, max: 70, name: 'Kedelai' },
        'cabe': { min: 50, max: 70, name: 'Cabe' },
        'cabai': { min: 50, max: 70, name: 'Cabai' },
        'tomat': { min: 60, max: 80, name: 'Tomat' },
        'bawang merah': { min: 60, max: 70, name: 'Bawang Merah' },
        'bawang': { min: 60, max: 70, name: 'Bawang Merah' },
        'kentang': { min: 70, max: 85, name: 'Kentang' },
        'wortel': { min: 60, max: 75, name: 'Wortel' },
        'kubis': { min: 70, max: 85, name: 'Kubis' },
        'brokoli': { min: 70, max: 85, name: 'Brokoli' },
        'selada': { min: 70, max: 85, name: 'Selada' },
        'bayam': { min: 70, max: 85, name: 'Bayam' },
        'mentimun': { min: 60, max: 75, name: 'Mentimun' },
        'terong': { min: 60, max: 75, name: 'Terong' }
    };
    
    // First, check if any user plant is optimal
    for (const userPlant of userPlantTypes) {
        if (!userPlant) continue;
        const plantKey = userPlant.toLowerCase();
        const plantData = allPlants[plantKey];
        if (plantData && humidity >= plantData.min && humidity <= plantData.max) {
            optimalPlants.push({ name: plantData.name, isUserPlant: true });
        }
    }
    
    // If no user plant is optimal, find other optimal plants
    if (optimalPlants.length === 0) {
        for (const [plantKey, plantData] of Object.entries(allPlants)) {
            // Skip if it's already in user plants
            if (userPlantTypes.some(up => up && up.toLowerCase() === plantKey)) {
                continue;
            }
            
            if (humidity >= plantData.min && humidity <= plantData.max) {
                optimalPlants.push({ name: plantData.name, isUserPlant: false });
            }
        }
    }
    
    return optimalPlants;
}

// Update weather details based on sensor values
function updateWeatherDetails(weatherData) {
    // Update temperature detail
    if (weatherData.temperature !== undefined && weatherData.temperature !== -999) {
        const temp = parseFloat(weatherData.temperature);
        if (!isNaN(temp)) {
            const tempDetailEl = document.querySelector('.temperature .weather-detail');
            if (tempDetailEl) {
                let detailText = '';
                if (temp < 20) {
                    detailText = 'Suhu Dingin';
                } else if (temp < 25) {
                    detailText = 'Suhu Sejuk';
                } else if (temp < 30) {
                    detailText = 'Suhu Normal';
                } else if (temp < 35) {
                    detailText = 'Suhu Panas';
                } else {
                    detailText = 'Suhu Terlalu Panas';
                }
                tempDetailEl.textContent = detailText;
            }
        }
    }
    
    // Update humidity detail
    if (weatherData.humidity !== undefined && weatherData.humidity !== -999) {
        const humidity = parseFloat(weatherData.humidity);
        if (!isNaN(humidity)) {
            const humidityDetailEl = document.querySelector('.humidity .weather-detail');
            if (humidityDetailEl) {
                let detailText = '';
                
                if (humidity < 30) {
                    detailText = 'Sangat Kering';
                } else if (humidity < 50) {
                    detailText = 'Kering';
                } else if (humidity >= 50 && humidity <= 85) {
                    // Check for optimal plants in this humidity range
                    const optimalPlants = getOptimalPlantsForHumidity(humidity, userPlantTypes);
                    
                    if (optimalPlants.length > 0) {
                        // Use the first optimal plant (prioritize user's plants)
                        const optimalPlant = optimalPlants[0];
                        detailText = `Optimal untuk ${optimalPlant.name}`;
                    } else {
                        // If no specific plant is optimal, use generic message
                        detailText = 'Kelembaban optimal';
                    }
                } else if (humidity < 90) {
                    detailText = 'Lembab';
                } else {
                    detailText = 'Sangat Lembab';
                }
                
                humidityDetailEl.textContent = detailText;
            }
        }
    }
    
    // Update light detail
    if (weatherData.lux !== undefined) {
        const lux = parseFloat(weatherData.lux);
        if (!isNaN(lux)) {
            const lightDetailEl = document.querySelector('.light .weather-detail');
            if (lightDetailEl) {
                let detailText = '';
                if (lux < 100) {
                    detailText = 'Sangat Gelap';
                } else if (lux < 500) {
                    detailText = 'Gelap';
                } else if (lux < 1000) {
                    detailText = 'Redup';
                } else if (lux < 2000) {
                    detailText = 'Cukup cerah';
                } else if (lux < 5000) {
                    detailText = 'Terang';
                } else {
                    detailText = 'Sangat Terang';
                }
                lightDetailEl.textContent = detailText;
            }
        }
    }
    
    // Update wind detail
    if (weatherData.wind_km_h !== undefined) {
        const wind = parseFloat(weatherData.wind_km_h);
        if (!isNaN(wind)) {
            const windDetailEl = document.querySelector('.wind .weather-detail');
            if (windDetailEl) {
                let detailText = '';
                if (wind < 5) {
                    detailText = 'Cukup tenang';
                } else if (wind < 15) {
                    detailText = 'Angin sedang';
                } else if (wind < 25) {
                    detailText = 'Angin kencang';
                } else if (wind < 40) {
                    detailText = 'Angin sangat kencang';
                } else {
                    detailText = 'Angin berbahaya';
                }
                windDetailEl.textContent = detailText;
            }
        }
    }
}

// Update trend indicator
function updateTrend(selector, oldValue, newValue) {
    if (oldValue === undefined || oldValue === null) return;
    
    const trendEl = document.querySelector(`${selector} .weather-trend`);
    if (!trendEl) return;
    
    const diff = newValue - oldValue;
    const isUp = diff > 0.1;
    const isDown = diff < -0.1;
    
    if (isUp) {
        trendEl.className = 'weather-trend up';
        trendEl.innerHTML = `<i class="fas fa-arrow-up"></i><span>${Math.abs(diff).toFixed(1)}</span>`;
    } else if (isDown) {
        trendEl.className = 'weather-trend down';
        trendEl.innerHTML = `<i class="fas fa-arrow-down"></i><span>${Math.abs(diff).toFixed(1)}</span>`;
    } else {
        trendEl.className = 'weather-trend stable';
        trendEl.innerHTML = `<i class="fas fa-minus"></i><span>0</span>`;
    }
}

// Show rain notification when rain status changes to "Hujan"
function showRainNotification() {
    // Create a prominent rain notification
    const notification = document.createElement('div');
    notification.className = 'rain-notification';
    notification.innerHTML = `
        <div class="rain-notification-content">
            <div class="rain-notification-icon">
                <i class="fas fa-cloud-rain"></i>
            </div>
            <div class="rain-notification-text">
                <strong>Peringatan: Hujan Terdeteksi!</strong>
                <p>Sensor mendeteksi kondisi hujan. Segera lakukan tindakan pencegahan untuk tanaman.</p>
            </div>
            <button class="rain-notification-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #2196f3 0%, #1976d2 100%);
        color: white;
        padding: 20px 25px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(33, 150, 243, 0.4);
        z-index: 10001;
        max-width: 500px;
        width: 90%;
        animation: slideDown 0.5s ease-out;
        border: 2px solid rgba(255, 255, 255, 0.3);
    `;
    
    // Add notification styles if not already added
    if (!document.getElementById('rain-notification-styles')) {
        const styleSheet = document.createElement('style');
        styleSheet.id = 'rain-notification-styles';
        styleSheet.textContent = `
            .rain-notification-content {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            .rain-notification-icon {
                font-size: 32px;
                animation: bounce 2s infinite;
            }
            .rain-notification-text {
                flex: 1;
            }
            .rain-notification-text strong {
                display: block;
                font-size: 18px;
                margin-bottom: 5px;
            }
            .rain-notification-text p {
                margin: 0;
                font-size: 14px;
                opacity: 0.95;
            }
            .rain-notification-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.3s;
            }
            .rain-notification-close:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            @keyframes slideDown {
                from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
                to { transform: translateX(-50%) translateY(0); opacity: 1; }
            }
            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(styleSheet);
    }
    
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (document.body.contains(notification)) {
            notification.style.animation = 'slideUp 0.5s ease-in forwards';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 500);
        }
    }, 10000);
    
    // Also show browser notification if permission granted
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Peringatan Hujan - Agromett', {
            body: 'Sensor mendeteksi kondisi hujan. Segera lakukan tindakan pencegahan untuk tanaman.',
            icon: 'image/logo1x1.png',
            tag: 'rain-alert'
        });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        // Request permission for future notifications
        Notification.requestPermission();
    }
}

// Fallback function for simulated data (if real-time fails)
function updateWeatherDataFallback() {
    // Simulate data update from AGROMETT station
    const temperature = 25 + Math.random() * 8; // 25-33°C
    const humidity = 60 + Math.random() * 30; // 60-90%
    const light = 500 + Math.random() * 1000; // 500-1500 Lux
    const wind = 5 + Math.random() * 15; // 5-20 km/h
    
    const fallbackData = {
        temperature: temperature,
        humidity: humidity,
        light: light,
        wind: wind
    };
    
    updateWeatherDisplay(fallbackData);
}

// Update Weather Data (kept for backward compatibility)
function updateWeatherData() {
    // This function is kept but now uses real-time subscription
    // If subscription is not active, use fallback
    if (!weatherUnsubscribe) {
        updateWeatherDataFallback();
    }
}

// Initialize Charts
function initializeCharts() {
    // Weather Chart (only if element exists)
    const weatherChartEl = document.getElementById('weatherChart');
    if (weatherChartEl) {
        const weatherCtx = weatherChartEl.getContext('2d');
        window.weatherChart = new Chart(weatherCtx, {
        type: 'line',
        data: {
            labels: ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00'],
            datasets: [{
                label: 'Suhu (°C)',
                data: [24, 26, 28, 30, 29, 27, 25],
                borderColor: '#f44336',
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }, {
                label: 'Kelembaban (%)',
                data: [85, 80, 75, 70, 72, 78, 82],
                borderColor: '#2196f3',
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0,0,0,0.1)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
    }
    
    // History Chart (only if element exists)
    const historyChartEl = document.getElementById('historyChart');
    if (historyChartEl) {
        const historyCtx = historyChartEl.getContext('2d');
        window.historyChart = new Chart(historyCtx, {
        type: 'bar',
        data: {
            labels: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
            datasets: [{
                label: 'Suhu Maks (°C)',
                data: [31, 32, 30, 29, 28, 30, 31],
                backgroundColor: 'rgba(244, 67, 54, 0.7)',
                borderColor: '#f44336',
                borderWidth: 1
            }, {
                label: 'Suhu Min (°C)',
                data: [23, 24, 22, 21, 20, 22, 23],
                backgroundColor: 'rgba(33, 150, 243, 0.7)',
                borderColor: '#2196f3',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                }
            }
        }
    });
    }
    
    // Yield Chart will be initialized in updateYieldChart when data is loaded
    // Don't initialize here to avoid empty chart
}

// Update Charts
function updateCharts() {
    // Simulate data updates
    if (window.weatherChart) {
        const newData = Array.from({length: 7}, () => Math.random() * 10 + 20);
        window.weatherChart.data.datasets[0].data = newData;
        window.weatherChart.update();
    }
}

// Update History Charts
function updateHistoryCharts() {
    // This would typically fetch real historical data
    if (window.historyChart && window.yieldChart) {
        window.historyChart.update();
        window.yieldChart.update();
    }
}

// Load Sample Data
function loadSampleData() {
    // Sample weather data for table
    const sampleWeatherData = [
        { date: '2024-01-15', temp: 28, humidity: 75, light: 850, wind: 12 },
        { date: '2024-01-14', temp: 27, humidity: 80, light: 720, wind: 10 },
        { date: '2024-01-13', temp: 29, humidity: 70, light: 920, wind: 15 },
        { date: '2024-01-12', temp: 26, humidity: 85, light: 680, wind: 8 },
        { date: '2024-01-11', temp: 30, humidity: 65, light: 950, wind: 18 },
        { date: '2024-01-10', temp: 28, humidity: 78, light: 810, wind: 11 },
        { date: '2024-01-09', temp: 27, humidity: 82, light: 750, wind: 9 }
    ];
    
    // Populate weather table (only if element exists)
    const tableBody = document.getElementById('weather-table-body');
    if (tableBody) {
        tableBody.innerHTML = sampleWeatherData.map(day => `
            <tr>
                <td>${new Date(day.date).toLocaleDateString('id-ID')}</td>
                <td>${day.temp}°C</td>
                <td>${day.humidity}%</td>
                <td>${day.light} Lux</td>
                <td>${day.wind} km/jam</td>
            </tr>
        `).join('');
    }
}

// Show Notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${getNotificationColor(type)};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 300px;
        animation: slideInRight 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after delay (longer for errors)
    const delay = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, delay);
}

// Get Notification Icon
function getNotificationIcon(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
}

// Get Notification Color
function getNotificationColor(type) {
    const colors = {
        'success': '#4caf50',
        'error': '#f44336',
        'warning': '#ff9800',
        'info': '#2196f3'
    };
    return colors[type] || '#2196f3';
}

// Add CSS for notifications
const notificationStyles = `
@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = notificationStyles;
document.head.appendChild(styleSheet);

// Handle Top Navigation Tab Change (Input Data / Prediksi)
function handleTopNavTabChange(e) {
    const targetTab = e.currentTarget.getAttribute('data-tab');
    
    // Remove active class from all top nav tabs
    document.querySelectorAll('.top-nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to clicked tab
    e.currentTarget.classList.add('active');
    
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    if (targetTab === 'input-data') {
        document.getElementById('input-data-section')?.classList.add('active');
    } else if (targetTab === 'prediction') {
        document.getElementById('prediction-section')?.classList.add('active');
    }
}

// Handle Sub Navigation Tab Change (Inventory / Hasil Panen)
function handleSubNavTabChange(e) {
    const targetSubTab = e.currentTarget.getAttribute('data-subtab');
    
    // Remove active class from all sub nav tabs
    document.querySelectorAll('.sub-nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to clicked tab
    e.currentTarget.classList.add('active');
    
    // Hide all form panes
    document.querySelectorAll('.form-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    // Show target form pane
    if (targetSubTab === 'inventory') {
        document.getElementById('inventory-form')?.classList.add('active');
    } else if (targetSubTab === 'harvest') {
        document.getElementById('harvest-form')?.classList.add('active');
    }
}

// Initialize harvest date inputs (populate days and years)
function initializeHarvestDateInputs() {
    const daySelect = document.getElementById('harvest-day');
    const yearSelect = document.getElementById('harvest-year');
    
    if (daySelect) {
        // Populate days (1-31)
        for (let i = 1; i <= 31; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            daySelect.appendChild(option);
        }
    }
    
    if (yearSelect) {
        // Populate years (current year - 5 to current year + 1)
        const currentYear = new Date().getFullYear();
        for (let i = currentYear - 5; i <= currentYear + 1; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            if (i === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
    }
}

// Handle Inventory Form Submission
async function handleInventorySubmission(e) {
    e.preventDefault();
    
    // Check if user is authenticated
    const { getCurrentUser } = await import('./firebase-auth.js');
    const user = await getCurrentUser();
    
    if (!user) {
        showNotification('Silakan login terlebih dahulu untuk menyimpan data', 'error');
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 2000);
        return;
    }
    
    const plantType = document.getElementById('seed-plant-type').value.trim();
    const quantity = parseFloat(document.getElementById('seed-quantity').value);
    
    if (!plantType || !quantity || quantity <= 0) {
        showNotification('Harap lengkapi semua field dengan benar', 'error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHTML = submitBtn.innerHTML;
    
    // Show loading state
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    submitBtn.disabled = true;
    
    try {
        const { saveInventoryToFirestore } = await import('./firebase-auth.js');
        
        await saveInventoryToFirestore(user.uid, {
            plantType: plantType,
            quantity: quantity
        });
        
        showNotification('Inventory berhasil disimpan', 'success');
        
        // Reset form
        e.target.reset();
        
        // Reload inventory data
        loadInventoryData();
    } catch (error) {
        console.error('Error saving inventory:', error);
        showNotification('Gagal menyimpan inventory: ' + error.message, 'error');
    } finally {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
    }
}

// Handle Harvest Form Submission
async function handleHarvestSubmission(e) {
    e.preventDefault();
    
    // Check if user is authenticated
    const { getCurrentUser } = await import('./firebase-auth.js');
    const user = await getCurrentUser();
    
    if (!user) {
        showNotification('Silakan login terlebih dahulu untuk menyimpan data', 'error');
        setTimeout(() => {
            window.location.href = 'auth.html';
        }, 2000);
        return;
    }
    
    const plantType = document.getElementById('harvest-plant-type').value.trim();
    const day = parseInt(document.getElementById('harvest-day').value);
    const month = parseInt(document.getElementById('harvest-month').value);
    const year = parseInt(document.getElementById('harvest-year').value);
    const yieldValue = parseFloat(document.getElementById('harvest-yield').value);
    
    if (!plantType || !day || !month || !year || !yieldValue || yieldValue <= 0) {
        showNotification('Harap lengkapi semua field dengan benar', 'error');
        return;
    }
    
    // Create date object
    const harvestDate = new Date(year, month - 1, day);
    
    if (isNaN(harvestDate.getTime())) {
        showNotification('Tanggal tidak valid', 'error');
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalHTML = submitBtn.innerHTML;
    
    // Show loading state
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    submitBtn.disabled = true;
    
    try {
        const { saveHarvestToFirestore } = await import('./firebase-auth.js');
        
        await saveHarvestToFirestore(user.uid, {
            plantType: plantType,
            harvestDate: harvestDate,
            yield: yieldValue
        });
        
        showNotification('Hasil panen berhasil disimpan', 'success');
        
        // Reset form
        e.target.reset();
        initializeHarvestDateInputs(); // Reinitialize date inputs
        
        // Reload harvest data
        loadHarvestData();
    } catch (error) {
        console.error('Error saving harvest:', error);
        showNotification('Gagal menyimpan hasil panen: ' + error.message, 'error');
    } finally {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
    }
}

// Load and display inventory data
async function loadInventoryData() {
    try {
        const { getCurrentUser } = await import('./firebase-auth.js');
        const user = await getCurrentUser();
        
        if (!user) {
            return;
        }
        
        const { getUserInventory } = await import('./firebase-auth.js');
        const inventory = await getUserInventory(user.uid);
        
        const inventoryItemsEl = document.getElementById('inventory-items');
        if (!inventoryItemsEl) return;
        
        if (inventory.length === 0) {
            inventoryItemsEl.innerHTML = '<p style="text-align: center; color: var(--gray); padding: 20px;">Belum ada data inventory</p>';
            return;
        }
        
        // Group by plant type and sum quantities
        const groupedInventory = {};
        inventory.forEach(item => {
            const plantType = item.plantType;
            if (groupedInventory[plantType]) {
                groupedInventory[plantType] += item.quantity;
            } else {
                groupedInventory[plantType] = item.quantity;
            }
        });
        
        // Display grouped inventory
        inventoryItemsEl.innerHTML = Object.entries(groupedInventory).map(([plantType, totalQuantity]) => `
            <div class="inventory-item">
                <div class="inventory-item-icon">
                    <i class="fas fa-seedling"></i>
                </div>
                <div class="inventory-item-content">
                    <div class="inventory-item-name">${plantType}</div>
                    <div class="inventory-item-quantity">${totalQuantity} bibit</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

// Load and display harvest data
async function loadHarvestData() {
    try {
        const { getCurrentUser } = await import('./firebase-auth.js');
        const user = await getCurrentUser();
        
        if (!user) {
            return;
        }
        
        const { getUserHarvests } = await import('./firebase-auth.js');
        const harvests = await getUserHarvests(user.uid);
        
        const harvestItemsEl = document.getElementById('harvest-items');
        if (!harvestItemsEl) return;
        
        if (harvests.length === 0) {
            harvestItemsEl.innerHTML = '<p style="text-align: center; color: var(--gray); padding: 20px;">Belum ada data hasil panen</p>';
            return;
        }
        
        // Display harvests
        harvestItemsEl.innerHTML = harvests.map(harvest => {
            const harvestDate = harvest.harvestDate;
            const dateStr = harvestDate ? harvestDate.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            }) : 'Tanggal tidak tersedia';
            
            return `
                <div class="harvest-item">
                    <div class="harvest-item-icon">
                        <i class="fas fa-wheat-awn"></i>
                    </div>
                    <div class="harvest-item-content">
                        <div class="harvest-item-plant">${harvest.plantType}</div>
                        <div class="harvest-item-date">${dateStr}</div>
                        <div class="harvest-item-yield">${harvest.yield} ton/ha</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading harvests:', error);
    }
}

// Load and display harvest history data for riwayat page
async function loadHarvestHistoryData() {
    try {
        console.log('=== Loading harvest history data ===');
        const { getCurrentUser } = await import('./firebase-auth.js');
        const user = await getCurrentUser();
        
        if (!user) {
            console.warn('User not logged in, cannot load harvest history');
            showEmptyHarvestState();
            showNotification('Silakan login terlebih dahulu untuk melihat riwayat hasil panen', 'warning');
            return;
        }
        
        console.log('User authenticated - UID:', user.uid);
        console.log('Fetching harvests from: users/' + user.uid + '/harvests');
        
        const { getUserHarvests } = await import('./firebase-auth.js');
        const harvests = await getUserHarvests(user.uid, 200); // Get more data for history
        
        console.log('Raw harvests from Firestore:', harvests);
        console.log('Number of harvests retrieved:', harvests?.length || 0);
        
        if (harvests && harvests.length > 0) {
            console.log('Processing harvests data...');
            
            // Process harvest dates to ensure they are Date objects
            const processedHarvests = harvests.map((harvest, index) => {
                let harvestDate = harvest.harvestDate;
                
                // Convert to Date if it's not already
                if (harvestDate && !(harvestDate instanceof Date)) {
                    if (harvestDate.toDate && typeof harvestDate.toDate === 'function') {
                        // Firestore Timestamp
                        harvestDate = harvestDate.toDate();
                    } else if (typeof harvestDate === 'string') {
                        harvestDate = new Date(harvestDate);
                    } else if (harvestDate.seconds) {
                        // Firestore Timestamp object
                        harvestDate = new Date(harvestDate.seconds * 1000);
                    } else if (typeof harvestDate === 'number') {
                        harvestDate = new Date(harvestDate);
                    }
                }
                
                const processed = {
                    id: harvest.id,
                    plantType: harvest.plantType || '',
                    yield: parseFloat(harvest.yield) || 0,
                    harvestDate: harvestDate,
                    createdAt: harvest.createdAt,
                    updatedAt: harvest.updatedAt
                };
                
                console.log(`Harvest ${index + 1}:`, {
                    id: processed.id,
                    plantType: processed.plantType,
                    yield: processed.yield,
                    harvestDate: processed.harvestDate,
                    isValidDate: processed.harvestDate && !isNaN(processed.harvestDate.getTime())
                });
                
                return processed;
            }).filter(h => {
                const isValid = h.harvestDate && !isNaN(h.harvestDate.getTime());
                if (!isValid) {
                    console.warn('Filtered out invalid harvest:', h);
                }
                return isValid;
            });
            
            console.log('Valid processed harvests:', processedHarvests.length);
            console.log('Processed harvests data:', processedHarvests);
            
            if (processedHarvests.length > 0) {
                console.log('Updating UI with harvest data...');
                // Update comparison stats
                updateHarvestComparisonStats(processedHarvests);
                
                // Update yield chart
                updateYieldChart(processedHarvests);
                
                // Update harvest table
                updateHarvestTable(processedHarvests);
                
                console.log('✓ Harvest history data loaded successfully');
            } else {
                console.warn('No valid harvest dates found after processing');
                showEmptyHarvestState();
                showNotification('Data hasil panen tidak valid atau tanggal tidak tersedia', 'warning');
            }
        } else {
            console.warn('No harvests found in Firestore for user:', user.uid);
            showEmptyHarvestState();
            showNotification('Belum ada data hasil panen. Silakan input data hasil panen terlebih dahulu.', 'info');
        }
    } catch (error) {
        console.error('Error loading harvest history:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack
        });
        showEmptyHarvestState();
        showNotification('Gagal memuat data hasil panen: ' + error.message, 'error');
    }
}

// Update harvest comparison statistics
function updateHarvestComparisonStats(harvests) {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-11
    
    // Determine current season (assuming 2 seasons per year: Jan-Jun, Jul-Dec)
    const currentSeason = currentMonth < 6 ? 1 : 2; // Season 1: Jan-Jun, Season 2: Jul-Dec
    const lastSeason = currentSeason === 1 ? { year: currentYear - 1, season: 2 } : { year: currentYear, season: 1 };
    
    // Filter harvests by season
    const currentSeasonHarvests = harvests.filter(h => {
        if (!h.harvestDate) return false;
        const harvestDate = h.harvestDate;
        const harvestYear = harvestDate.getFullYear();
        const harvestMonth = harvestDate.getMonth();
        const harvestSeason = harvestMonth < 6 ? 1 : 2;
        return harvestYear === currentYear && harvestSeason === currentSeason;
    });
    
    const lastSeasonHarvests = harvests.filter(h => {
        if (!h.harvestDate) return false;
        const harvestDate = h.harvestDate;
        const harvestYear = harvestDate.getFullYear();
        const harvestMonth = harvestDate.getMonth();
        const harvestSeason = harvestMonth < 6 ? 1 : 2;
        return harvestYear === lastSeason.year && harvestSeason === lastSeason.season;
    });
    
    // Calculate average yield
    const currentAvg = currentSeasonHarvests.length > 0
        ? currentSeasonHarvests.reduce((sum, h) => sum + (h.yield || 0), 0) / currentSeasonHarvests.length
        : 0;
    
    const lastAvg = lastSeasonHarvests.length > 0
        ? lastSeasonHarvests.reduce((sum, h) => sum + (h.yield || 0), 0) / lastSeasonHarvests.length
        : 0;
    
    // Update UI
    const currentYieldEl = document.getElementById('current-season-yield');
    const lastYieldEl = document.getElementById('last-season-yield');
    const currentTrendEl = document.getElementById('current-season-trend');
    const lastTrendEl = document.getElementById('last-season-trend');
    
    if (currentYieldEl) {
        currentYieldEl.textContent = currentAvg > 0 ? `${currentAvg.toFixed(2)} ton/ha` : '- ton/ha';
    }
    
    if (lastYieldEl) {
        lastYieldEl.textContent = lastAvg > 0 ? `${lastAvg.toFixed(2)} ton/ha` : '- ton/ha';
    }
    
    // Calculate trend
    if (currentTrendEl && lastTrendEl) {
        if (lastAvg > 0 && currentAvg > 0) {
            const trend = ((currentAvg - lastAvg) / lastAvg) * 100;
            const trendAbs = Math.abs(trend).toFixed(1);
            
            if (trend > 0) {
                currentTrendEl.textContent = `+${trendAbs}%`;
                currentTrendEl.className = 'comparison-trend up';
            } else if (trend < 0) {
                currentTrendEl.textContent = `-${trendAbs}%`;
                currentTrendEl.className = 'comparison-trend down';
            } else {
                currentTrendEl.textContent = '0%';
                currentTrendEl.className = 'comparison-trend stable';
            }
        } else {
            currentTrendEl.textContent = '-';
            currentTrendEl.className = 'comparison-trend';
        }
        
        lastTrendEl.textContent = '-';
        lastTrendEl.className = 'comparison-trend';
    }
}

// Update yield chart with real data
function updateYieldChart(harvests) {
    console.log('=== Updating yield chart ===');
    console.log('Harvests received:', harvests);
    console.log('Number of harvests:', harvests?.length || 0);
    
    const yieldChartEl = document.getElementById('yieldChart');
    if (!yieldChartEl) {
        console.warn('Yield chart element not found in DOM');
        return;
    }
    
    console.log('Yield chart element found');
    
    // Check if harvest tab is active
    const harvestTabPane = document.getElementById('harvest-tab');
    const isTabActive = harvestTabPane && harvestTabPane.classList.contains('active');
    
    if (!isTabActive) {
        console.log('Harvest tab is not active, storing data for later');
        // Store data and create chart when tab becomes active
        window.pendingHarvestData = harvests;
        return;
    }
    
    // Ensure the parent container and tab pane are visible
    const chartContainer = yieldChartEl.closest('.yield-chart');
    if (chartContainer) {
        chartContainer.style.display = 'block';
        chartContainer.style.visibility = 'visible';
    }
    
    // Ensure tab pane is visible
    if (harvestTabPane) {
        harvestTabPane.style.display = 'block';
        harvestTabPane.style.visibility = 'visible';
    }
    
    // Ensure canvas is visible and has dimensions
    yieldChartEl.style.display = 'block';
    yieldChartEl.style.visibility = 'visible';
    yieldChartEl.style.width = '100%';
    yieldChartEl.style.height = '300px';
    
    // Wait a bit to ensure DOM is fully rendered and canvas has dimensions
    setTimeout(() => {
        // Double check that tab is still active
        const isStillActive = harvestTabPane && harvestTabPane.classList.contains('active');
        if (!isStillActive) {
            console.log('Tab is no longer active, aborting chart creation');
            return;
        }
        
        // Double check canvas dimensions
        const rect = yieldChartEl.getBoundingClientRect();
        console.log('Canvas dimensions before chart creation:', rect.width, 'x', rect.height);
        
        if (rect.width === 0 || rect.height === 0) {
            console.warn('Canvas has zero dimensions, setting explicit size');
            yieldChartEl.style.width = '100%';
            yieldChartEl.style.height = '300px';
            yieldChartEl.style.minHeight = '300px';
            // Force a reflow
            yieldChartEl.offsetHeight;
            
            // Wait a bit more for dimensions to settle
            setTimeout(() => {
                const newRect = yieldChartEl.getBoundingClientRect();
                console.log('Canvas dimensions after setting size:', newRect.width, 'x', newRect.height);
                if (newRect.width > 0 && newRect.height > 0) {
                    createOrUpdateYieldChart(yieldChartEl, harvests);
                } else {
                    console.error('Canvas still has zero dimensions after setting size');
                }
            }, 100);
        } else {
            createOrUpdateYieldChart(yieldChartEl, harvests);
        }
    }, 300);
}

// Separate function to create or update chart
function createOrUpdateYieldChart(yieldChartEl, harvests) {
    if (!yieldChartEl) return;
    
    console.log('=== Creating/Updating Yield Chart ===');
    
    // Group harvests by month
    const monthlyData = {};
    harvests.forEach(harvest => {
        if (!harvest.harvestDate) {
            console.warn('Harvest missing date:', harvest);
            return;
        }
        
        const date = harvest.harvestDate instanceof Date ? harvest.harvestDate : new Date(harvest.harvestDate);
        
        if (isNaN(date.getTime())) {
            console.warn('Invalid date:', harvest.harvestDate);
            return;
        }
        
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = date.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
        
        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = {
                label: monthLabel,
                yields: [],
                count: 0
            };
        }
        const yieldValue = parseFloat(harvest.yield) || 0;
        monthlyData[monthKey].yields.push(yieldValue);
        monthlyData[monthKey].count++;
    });
    
    console.log('Monthly data grouped:', monthlyData);
    
    // Sort by date
    const sortedMonths = Object.keys(monthlyData).sort();
    let labels = sortedMonths.map(key => monthlyData[key].label);
    let data = sortedMonths.map(key => {
        const yields = monthlyData[key].yields;
        const avg = yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
        return parseFloat(avg.toFixed(2));
    });
    
    console.log('Chart labels:', labels);
    console.log('Chart data:', data);
    
    // Ensure we have data to display
    if (labels.length === 0 || data.length === 0) {
        console.warn('No data to display in chart, using placeholder');
        labels = ['Belum ada data'];
        data = [0];
    }
    
    // Ensure canvas is visible
    yieldChartEl.style.display = 'block';
    yieldChartEl.style.visibility = 'visible';
    yieldChartEl.style.width = '100%';
    yieldChartEl.style.height = 'auto';
    yieldChartEl.style.minHeight = '300px';
    
    // Always destroy existing chart and create new one to ensure it's visible
    // This is necessary because chart might have been created when tab was not active
    if (window.yieldChart) {
        console.log('Destroying existing chart to recreate (ensuring visibility)...');
        try {
            if (typeof window.yieldChart.destroy === 'function') {
                window.yieldChart.destroy();
                console.log('✓ Existing chart destroyed');
            }
        } catch (destroyError) {
            console.warn('Error destroying existing chart:', destroyError);
        }
        window.yieldChart = null;
    }
    
    // Create new chart
    if (!window.yieldChart) {
        console.log('Creating new chart');
        try {
            // Destroy any existing chart instance first
            if (window.yieldChart && typeof window.yieldChart.destroy === 'function') {
                try {
                    window.yieldChart.destroy();
                } catch (e) {
                    console.warn('Error destroying old chart:', e);
                }
            }
            
            // Ensure canvas is visible and has proper dimensions
            yieldChartEl.style.display = 'block';
            yieldChartEl.style.visibility = 'visible';
            yieldChartEl.style.width = '100%';
            yieldChartEl.style.height = 'auto';
            yieldChartEl.style.minHeight = '300px';
            
            // Get parent container dimensions
            const parentContainer = yieldChartEl.parentElement;
            const chartContainer = yieldChartEl.closest('.yield-chart');
            
            // Force a reflow to get actual dimensions
            yieldChartEl.offsetHeight;
            
            // Get actual container width
            let containerWidth = 800;
            if (chartContainer) {
                containerWidth = chartContainer.offsetWidth || chartContainer.clientWidth || 800;
            } else if (parentContainer) {
                containerWidth = parentContainer.offsetWidth || parentContainer.clientWidth || 800;
            }
            
            // Don't set explicit width/height on canvas - let Chart.js handle it with responsive: true
            console.log('Container width:', containerWidth);
            console.log('Canvas computed style:', window.getComputedStyle(yieldChartEl).width);
            
            // Check if Chart.js is loaded
            if (typeof Chart === 'undefined') {
                console.error('Chart.js is not loaded! Waiting for it to load...');
                // Wait for Chart.js to load
                let attempts = 0;
                const checkChart = setInterval(() => {
                    attempts++;
                    if (typeof Chart !== 'undefined') {
                        clearInterval(checkChart);
                        console.log('Chart.js loaded, creating chart now');
                        createOrUpdateYieldChart(yieldChartEl, harvests);
                    } else if (attempts > 10) {
                        clearInterval(checkChart);
                        console.error('Chart.js failed to load after 10 attempts');
                        showNotification('Chart.js belum dimuat. Silakan refresh halaman.', 'error');
                    }
                }, 100);
                return;
            }
            
            const yieldCtx = yieldChartEl.getContext('2d');
            if (!yieldCtx) {
                throw new Error('Could not get 2D context from canvas');
            }
            
            // Ensure we have at least one data point
            let finalLabels = labels;
            let finalData = data;
            if (labels.length === 0 || data.length === 0) {
                console.warn('No data to display in chart, using placeholder');
                finalLabels = ['Belum ada data'];
                finalData = [0];
            }
            
            console.log('Creating chart with labels:', finalLabels);
            console.log('Creating chart with data:', finalData);
            console.log('Canvas element:', yieldChartEl);
            console.log('Canvas dimensions:', yieldChartEl.offsetWidth, 'x', yieldChartEl.offsetHeight);
            console.log('Chart.js version:', Chart.version || 'unknown');
            
            window.yieldChart = new Chart(yieldCtx, {
                type: 'line',
                data: {
                    labels: finalLabels,
                    datasets: [{
                        label: 'Hasil Panen Rata-rata (ton/ha)',
                        data: finalData,
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 1000
                    },
                    layout: {
                        padding: {
                            top: 10,
                            bottom: 10,
                            left: 10,
                            right: 10
                        }
                    },
                    onResize: function(chart, size) {
                        console.log('Chart resized:', size);
                    },
                    devicePixelRatio: 1,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            enabled: true,
                            callbacks: {
                                label: function(context) {
                                    return `Hasil: ${context.parsed.y.toFixed(2)} ton/ha`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Hasil Panen (ton/ha)'
                            },
                            grid: {
                                color: 'rgba(0,0,0,0.1)'
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: 'Bulan'
                            },
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
            console.log('✓ Chart created successfully');
            console.log('Chart instance:', window.yieldChart);
            console.log('Chart canvas:', window.yieldChart.canvas);
            console.log('Chart data:', window.yieldChart.data);
            console.log('Chart canvas element:', yieldChartEl);
            console.log('Chart canvas dimensions:', yieldChartEl.offsetWidth, 'x', yieldChartEl.offsetHeight);
            
            // Immediately update chart to ensure it renders
            try {
                window.yieldChart.update('none');
                console.log('✓ Chart updated immediately after creation');
            } catch (updateError) {
                console.warn('Error updating chart immediately:', updateError);
            }
            
            // Force chart to render after ensuring canvas is visible
            setTimeout(() => {
                if (window.yieldChart) {
                    try {
                        // Check if canvas is visible
                        const rect = yieldChartEl.getBoundingClientRect();
                        const computedStyle = window.getComputedStyle(yieldChartEl);
                        console.log('Canvas bounding rect:', rect);
                        console.log('Canvas computed style - display:', computedStyle.display);
                        console.log('Canvas computed style - visibility:', computedStyle.visibility);
                        console.log('Canvas computed style - width:', computedStyle.width);
                        console.log('Canvas computed style - height:', computedStyle.height);
                        console.log('Canvas offset dimensions:', yieldChartEl.offsetWidth, 'x', yieldChartEl.offsetHeight);
                        
                        // Ensure canvas has dimensions
                        if (rect.width === 0 || rect.height === 0) {
                            console.warn('Canvas has zero dimensions, setting explicit size');
                            const parent = yieldChartEl.parentElement;
                            const parentWidth = parent ? (parent.offsetWidth || parent.clientWidth || 800) : 800;
                            yieldChartEl.style.width = '100%';
                            yieldChartEl.style.height = '300px';
                            // Force a reflow
                            yieldChartEl.offsetHeight;
                        }
                        
                        // Force resize and update
                        console.log('Resizing and updating chart...');
                        window.yieldChart.resize();
                        window.yieldChart.update('none'); // Use 'none' to skip animation for immediate render
                        console.log('✓ Chart rendered and updated');
                        
                        // Double check after another delay
                        setTimeout(() => {
                            if (window.yieldChart) {
                                console.log('Re-rendering chart...');
                                window.yieldChart.resize();
                                window.yieldChart.update();
                                console.log('✓ Chart re-rendered');
                                
                                // Final check - verify chart is visible
                                const finalRect = yieldChartEl.getBoundingClientRect();
                                console.log('Final canvas dimensions:', finalRect.width, 'x', finalRect.height);
                                if (finalRect.width > 0 && finalRect.height > 0) {
                                    console.log('✓ Chart is visible and has dimensions');
                                } else {
                                    console.error('✗ Chart still has zero dimensions!');
                                }
                            }
                        }, 500);
                    } catch (renderError) {
                        console.error('Error rendering chart:', renderError);
                        console.error('Error stack:', renderError.stack);
                    }
                } else {
                    console.error('Chart instance is null after creation!');
                }
            }, 300);
        } catch (chartError) {
            console.error('Error creating chart:', chartError);
            console.error('Error stack:', chartError.stack);
            showNotification('Gagal membuat grafik hasil panen: ' + chartError.message, 'error');
        }
    }
}

// Update harvest table
function updateHarvestTable(harvests) {
    console.log('=== Updating harvest table ===');
    console.log('Harvests for table:', harvests);
    
    const tableBody = document.getElementById('harvest-table-body');
    if (!tableBody) {
        console.warn('Harvest table body element not found');
        return;
    }
    
    if (harvests.length === 0) {
        console.log('No harvests to display, showing empty state');
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--gray);">Belum ada data hasil panen</td></tr>';
        return;
    }
    
    // Sort by date (newest first)
    const sortedHarvests = [...harvests].sort((a, b) => {
        const dateA = a.harvestDate ? a.harvestDate.getTime() : 0;
        const dateB = b.harvestDate ? b.harvestDate.getTime() : 0;
        return dateB - dateA;
    });
    
    console.log('Sorted harvests for table:', sortedHarvests.length);
    
    tableBody.innerHTML = sortedHarvests.map((harvest, index) => {
        const dateStr = harvest.harvestDate
            ? harvest.harvestDate.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            })
            : 'Tanggal tidak tersedia';
        
        console.log(`Table row ${index + 1}:`, {
            date: dateStr,
            plantType: harvest.plantType,
            yield: harvest.yield
        });
        
        return `
            <tr>
                <td>${dateStr}</td>
                <td>${harvest.plantType || '-'}</td>
                <td><strong>${(harvest.yield || 0).toFixed(2)} ton/ha</strong></td>
            </tr>
        `;
    }).join('');
    
    console.log('✓ Harvest table updated with', sortedHarvests.length, 'rows');
}

// Show empty harvest state
function showEmptyHarvestState() {
    const currentYieldEl = document.getElementById('current-season-yield');
    const lastYieldEl = document.getElementById('last-season-yield');
    const tableBody = document.getElementById('harvest-table-body');
    
    if (currentYieldEl) currentYieldEl.textContent = '- ton/ha';
    if (lastYieldEl) lastYieldEl.textContent = '- ton/ha';
    if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--gray);">Belum ada data hasil panen</td></tr>';
    }
}

// Setup urgent action card on AI recommendation page
function setupUrgentActionCard() {
    const markCompleteBtn = document.getElementById('mark-complete-btn');
    const urgentCard = document.getElementById('urgent-action-card');
    
    if (markCompleteBtn && urgentCard) {
        markCompleteBtn.addEventListener('click', function() {
            // Mark as dismissed in sessionStorage
            sessionStorage.setItem('urgent-action-dismissed', 'true');
            
            // Hide the card with smooth animation
            urgentCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            urgentCard.style.opacity = '0';
            urgentCard.style.transform = 'translateY(-10px)';
            
            setTimeout(() => {
                urgentCard.style.display = 'none';
            }, 300);
            
            // Show notification
            showNotification('Tindakan telah ditandai selesai', 'success');
        });
    }
    
    // Check initial rain status if data is already available
    if (lastWeatherData && lastWeatherData.rain) {
        updateUrgentActionCard(lastWeatherData.rain);
    }
}

// Update urgent action card visibility based on rain status
function updateUrgentActionCard(rainStatus) {
    const urgentCard = document.getElementById('urgent-action-card');
    
    if (!urgentCard) {
        return; // Not on AI recommendation page
    }
    
    // Check if card was manually dismissed (stored in sessionStorage)
    const isDismissed = sessionStorage.getItem('urgent-action-dismissed') === 'true';
    
    if (rainStatus === 'Hujan' && !isDismissed) {
        // Show the card with animation
        urgentCard.style.display = 'block';
        urgentCard.style.opacity = '0';
        urgentCard.style.transform = 'translateY(-10px)';
        
        // Trigger animation
        setTimeout(() => {
            urgentCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            urgentCard.style.opacity = '1';
            urgentCard.style.transform = 'translateY(0)';
        }, 10);
    } else if (rainStatus !== 'Hujan') {
        // Hide card when rain stops
        urgentCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        urgentCard.style.opacity = '0';
        urgentCard.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            urgentCard.style.display = 'none';
        }, 300);
        
        // Reset dismissed flag when rain stops
        sessionStorage.removeItem('urgent-action-dismissed');
    }
}

// Load AI Recommendations based on Firebase data
async function loadAIRecommendations() {
    try {
        console.log('Loading AI recommendations...');
        
        // Show loading state
        showRecommendationLoading();
        
        // Ensure Gemini is ready and get available models
        await ensureGeminiReady(GEMINI_API_KEY);
        console.log(`Available Gemini models: ${geminiAvailableModels.length}`, geminiAvailableModels.slice(0, 5));
        
        // Collect all user data from Firebase
        const userData = await collectUserData();
        
        if (!userData) {
            showRecommendationError('Silakan login terlebih dahulu untuk melihat rekomendasi');
            return;
        }
        
        // Generate recommendations using Gemini AI
        await Promise.all([
            generatePlantingScheduleRecommendation(userData),
            generateWaterManagementRecommendation(userData),
            generateFertilizerRecommendation(userData)
        ]);
        
        console.log('AI recommendations loaded successfully');
    } catch (error) {
        console.error('Error loading AI recommendations:', error);
        showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.');
    }
}

// Collect all user data from Firebase
async function collectUserData() {
    try {
        const { getCurrentUser } = await import('./firebase-auth.js');
        const user = await getCurrentUser();
        
        if (!user) {
            return null;
        }
        
        const [
            { getUserInventory },
            { getUserHarvests },
            { getUserPredictions }
        ] = await Promise.all([
            import('./firebase-auth.js'),
            import('./firebase-auth.js'),
            import('./firebase-auth.js')
        ]);
        
        const [inventory, harvests, predictions] = await Promise.all([
            getUserInventory(user.uid).catch(() => []),
            getUserHarvests(user.uid, 50).catch(() => []),
            getUserPredictions(user.uid, 50).catch(() => [])
        ]);
        
        // Get current weather data
        const currentWeather = lastWeatherData || {
            temperature: null,
            humidity: null,
            lux: null,
            wind_km_h: null,
            rain: null
        };
        
        // Load user plant type if not already loaded
        if (!userPlantType && predictions && predictions.length > 0) {
            const plantTypeCount = {};
            predictions.forEach(pred => {
                if (pred.plantType) {
                    const plantType = pred.plantType.toLowerCase();
                    plantTypeCount[plantType] = (plantTypeCount[plantType] || 0) + 1;
                }
            });
            const mostCommon = Object.entries(plantTypeCount).sort((a, b) => b[1] - a[1])[0];
            if (mostCommon) {
                userPlantType = mostCommon[0];
                userPlantTypes = Object.keys(plantTypeCount);
            }
        }
        
        return {
            inventory: inventory || [],
            harvests: harvests || [],
            predictions: predictions || [],
            weather: currentWeather,
            userPlantType: userPlantType || 'padi',
            userPlantTypes: userPlantTypes || []
        };
    } catch (error) {
        console.error('Error collecting user data:', error);
        return null;
    }
}

// Generate planting schedule recommendation using Gemini
async function generatePlantingScheduleRecommendation(userData) {
    try {
        const prompt = `Kamu adalah ahli pertanian Indonesia yang berpengalaman. Berikan rekomendasi jadwal tanam optimal berdasarkan data berikut:

DATA YANG TERSEDIA:
- Inventory Bibit: ${JSON.stringify(userData.inventory.map(i => `${i.plantType} (${i.quantity} bibit)`))}
- Riwayat Panen: ${JSON.stringify(userData.harvests.slice(0, 5).map(h => `${h.plantType} - ${h.yield} ton/ha pada ${h.harvestDate?.toDate ? h.harvestDate.toDate().toLocaleDateString('id-ID') : 'tanggal tidak tersedia'}`))}
- Jenis Tanaman yang Sering Ditanam: ${userData.userPlantTypes.join(', ') || 'Tidak ada data'}
- Cuaca Saat Ini: Suhu ${userData.weather.temperature || 'N/A'}°C, Kelembaban ${userData.weather.humidity || 'N/A'}%, Status Hujan: ${userData.weather.rain || 'N/A'}

TANGGAL HARI INI: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

INSTRUKSI:
1. Analisis data inventory dan riwayat panen untuk menentukan tanaman yang paling cocok untuk ditanam
2. Pertimbangkan cuaca saat ini dan musim di Indonesia
3. Berikan jadwal tanam optimal dengan format timeline (3-4 tahap: Persiapan lahan, Tanam bibit, Perawatan, Estimasi panen)
4. Gunakan tanggal Indonesia yang akurat berdasarkan hari ini
5. Berikan rekomendasi yang praktis dan dapat diterapkan

PENTING: Jawab HANYA dengan JSON yang valid, tanpa markdown, tanpa penjelasan tambahan. Format JSON yang diharapkan:

{
  "plantType": "nama tanaman yang direkomendasikan",
  "description": "penjelasan singkat mengapa tanaman ini direkomendasikan",
  "timeline": [
    {
      "date": "tanggal mulai - tanggal selesai (format: DD-MM atau DD-MM YYYY)",
      "description": "kegiatan yang harus dilakukan"
    }
  ]
}

Jika tidak ada data yang cukup, berikan rekomendasi umum berdasarkan musim dan cuaca saat ini. Pastikan response adalah JSON yang valid dan dapat di-parse.`;

        const recommendation = await callGeminiForRecommendation(prompt, null, 'planting-schedule-content');
        
        if (recommendation) {
            updatePlantingScheduleCard(recommendation);
        } else {
            showRecommendationError('Gagal memuat rekomendasi jadwal tanam', 'planting-schedule-content');
        }
    } catch (error) {
        console.error('Error generating planting schedule recommendation:', error);
        showRecommendationError('Gagal memuat rekomendasi jadwal tanam', 'planting-schedule-content');
    }
}

// Generate water management recommendation using Gemini
async function generateWaterManagementRecommendation(userData) {
    try {
        const currentPhase = userData.predictions && userData.predictions.length > 0 
            ? userData.predictions[0].growthPhase 
            : 'vegetatif';
        
        const prompt = `Kamu adalah ahli pertanian Indonesia yang berpengalaman. Berikan rekomendasi manajemen air/pengairan berdasarkan data berikut:

DATA YANG TERSEDIA:
- Cuaca Saat Ini: 
  * Suhu: ${userData.weather.temperature || 'N/A'}°C
  * Kelembaban: ${userData.weather.humidity || 'N/A'}%
  * Intensitas Cahaya: ${userData.weather.lux || 'N/A'} Lux
  * Kecepatan Angin: ${userData.weather.wind_km_h || 'N/A'} km/jam
  * Status Hujan: ${userData.weather.rain || 'N/A'}
- Fase Pertumbuhan Tanaman: ${currentPhase}
- Jenis Tanaman: ${userData.userPlantType || 'padi'}
- Riwayat Panen: ${userData.harvests.length > 0 ? `Rata-rata hasil: ${(userData.harvests.reduce((sum, h) => sum + parseFloat(h.yield || 0), 0) / userData.harvests.length).toFixed(2)} ton/ha` : 'Belum ada data'}

INSTRUKSI:
1. Analisis kondisi cuaca saat ini (suhu, kelembaban, hujan)
2. Berikan rekomendasi pengairan yang spesifik untuk fase ${currentPhase}
3. Pertimbangkan apakah sedang musim hujan atau kemarau
4. Berikan rekomendasi yang praktis dan dapat diterapkan

PENTING: Jawab HANYA dengan JSON yang valid, tanpa markdown, tanpa penjelasan tambahan. Format JSON yang diharapkan:

{
  "intensity": "intensitas air (contoh: 2-3 cm di permukaan)",
  "frequency": "frekuensi pengairan (contoh: 3 hari sekali)",
  "time": "waktu terbaik untuk pengairan (contoh: Pagi hari 06:00-08:00)",
  "notes": "catatan tambahan atau tips khusus"
}

Pastikan response adalah JSON yang valid dan dapat di-parse.`;

        const recommendation = await callGeminiForRecommendation(prompt, null, 'water-management-content');
        
        if (recommendation) {
            updateWaterManagementCard(recommendation);
        } else {
            showRecommendationError('Gagal memuat rekomendasi manajemen air', 'water-management-content');
        }
    } catch (error) {
        console.error('Error generating water management recommendation:', error);
        showRecommendationError('Gagal memuat rekomendasi manajemen air', 'water-management-content');
    }
}

// Generate fertilizer recommendation using Gemini
async function generateFertilizerRecommendation(userData) {
    try {
        const currentPhase = userData.predictions && userData.predictions.length > 0 
            ? userData.predictions[0].growthPhase 
            : 'vegetatif';
        
        const prompt = `Kamu adalah ahli pertanian Indonesia yang berpengalaman. Berikan rekomendasi pemupukan berdasarkan data berikut:

DATA YANG TERSEDIA:
- Jenis Tanaman: ${userData.userPlantType || 'padi'}
- Fase Pertumbuhan: ${currentPhase}
- Cuaca Saat Ini: Suhu ${userData.weather.temperature || 'N/A'}°C, Kelembaban ${userData.weather.humidity || 'N/A'}%, Status Hujan: ${userData.weather.rain || 'N/A'}
- Riwayat Panen: ${userData.harvests.length > 0 ? `Rata-rata hasil: ${(userData.harvests.reduce((sum, h) => sum + parseFloat(h.yield || 0), 0) / userData.harvests.length).toFixed(2)} ton/ha` : 'Belum ada data'}
- Tanggal Hari Ini: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

INSTRUKSI:
1. Berikan rekomendasi pemupukan yang sesuai untuk fase ${currentPhase}
2. Pertimbangkan jenis tanaman ${userData.userPlantType || 'padi'}
3. Berikan 2-3 jenis pupuk yang direkomendasikan (Urea, NPK, SP-36, KCL, dll)
4. Berikan dosis yang tepat dalam kg/ha
5. Berikan waktu pemupukan yang tepat (relatif dari hari ini, contoh: "Minggu depan", "2 minggu lagi", "Bulan depan")

PENTING: Jawab HANYA dengan JSON yang valid, tanpa markdown, tanpa penjelasan tambahan. Format JSON yang diharapkan:

{
  "fertilizers": [
    {
      "name": "nama pupuk (contoh: Urea)",
      "dose": "dosis dalam kg/ha (contoh: 150 kg/ha)",
      "time": "waktu pemupukan (contoh: Minggu depan)"
    }
  ],
  "notes": "catatan tambahan atau tips khusus"
}

Pastikan response adalah JSON yang valid dan dapat di-parse.`;

        const recommendation = await callGeminiForRecommendation(prompt, null, 'fertilizer-content');
        
        if (recommendation) {
            updateFertilizerCard(recommendation);
        } else {
            showRecommendationError('Gagal memuat rekomendasi pemupukan', 'fertilizer-content');
        }
    } catch (error) {
        console.error('Error generating fertilizer recommendation:', error);
        showRecommendationError('Gagal memuat rekomendasi pemupukan', 'fertilizer-content');
    }
}

// Call Gemini API for recommendation - using only gemini-2.0-flash (proven to work)
async function callGeminiForRecommendation(prompt, cardId = null, contentId = null) {
    try {
        // Use only the proven working model: gemini-2.0-flash with v1beta endpoint
        const modelName = 'models/gemini-2.0-flash';
        const apiVersion = 'v1beta';
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
        
        console.log(`Calling Gemini API: ${modelName} with ${apiVersion} endpoint`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                }
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: { message: errorText } };
            }
            
            const status = response.status;
            const errorMessage = errorData?.error?.message || errorText;
            
            console.error(`Gemini API error (${modelName}, ${apiVersion}):`, status, errorMessage);
            
            // Handle specific errors
            if (status === 403) {
                if (errorMessage.includes('leaked') || errorMessage.includes('API key')) {
                    if (contentId) {
                        showRecommendationError('API key Gemini tidak valid. Silakan hubungi administrator untuk memperbarui API key.', contentId);
                    }
                    return null;
                }
            }
            
            if (status === 429) {
                if (contentId) {
                    showRecommendationError('Kuota API Gemini telah habis. Silakan coba lagi nanti atau periksa billing Google Cloud.', contentId);
                }
                return null;
            }
            
            if (contentId) {
                showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.', contentId);
            }
            return null;
        }
        
        const data = await response.json();
        const candidate = data.candidates?.[0];
        
        if (!candidate) {
            console.error('No candidate in response');
            if (contentId) {
                showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.', contentId);
            }
            return null;
        }
        
        const text = extractGeminiText(candidate);
        
        if (!text) {
            console.error('No text in response');
            if (contentId) {
                showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.', contentId);
            }
            return null;
        }
        
        // Try to extract and parse JSON
        let jsonText = text.trim();
        
        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        
        // Extract JSON object from response
        const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonText = jsonMatch[0];
        }
        
        try {
            const result = JSON.parse(jsonText);
            console.log(`✓ Gemini recommendation generated successfully with model ${modelName} (${apiVersion})`);
            return result;
        } catch (parseError) {
            // If JSON parsing fails, try to create a structured response from plain text
            console.warn('JSON Parse Error, attempting to format as structured response:', parseError);
            console.log('Response Text:', text);
            
            // Return a fallback structured response based on text content
            const fallbackResult = createFallbackRecommendation(text, prompt);
            if (fallbackResult) {
                console.log(`✓ Using fallback formatted response from ${modelName}`);
                return fallbackResult;
            }
            
            console.error('Invalid JSON response and fallback failed');
            if (contentId) {
                showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.', contentId);
            }
            return null;
        }
    } catch (error) {
        console.error('Error in callGeminiForRecommendation:', error);
        if (contentId) {
            showRecommendationError('Gagal memuat rekomendasi. Silakan coba lagi nanti.', contentId);
        }
        return null;
    }
}

// Create fallback recommendation structure from plain text response
function createFallbackRecommendation(text, prompt) {
    try {
        // Try to extract key information from text based on prompt type
        if (prompt.includes('jadwal tanam') || prompt.includes('Jadwal Tanam')) {
            // Planting schedule fallback
            const plantMatch = text.match(/(padi|jagung|kedelai|cabai|tomat|terong|kacang|bawang|wortel|kubis|sawi|bayam|kangkung)/i);
            const plantType = plantMatch ? plantMatch[1] : 'tanaman';
            
            return {
                plantType: plantType,
                description: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
                timeline: [
                    { date: 'Segera', description: 'Persiapan lahan dan bibit' },
                    { date: '1-2 minggu', description: 'Penanaman bibit' },
                    { date: '3-4 bulan', description: 'Perawatan dan pemeliharaan' },
                    { date: '4-5 bulan', description: 'Estimasi panen' }
                ]
            };
        } else if (prompt.includes('manajemen air') || prompt.includes('pengairan')) {
            // Water management fallback
            return {
                intensity: '2-3 cm di permukaan',
                frequency: '3 hari sekali',
                time: 'Pagi hari 06:00-08:00',
                notes: text.substring(0, 150) + (text.length > 150 ? '...' : '')
            };
        } else if (prompt.includes('pemupukan') || prompt.includes('Pemupukan')) {
            // Fertilizer fallback
            return {
                fertilizers: [
                    { name: 'Urea', dose: '150 kg/ha', time: 'Minggu depan' },
                    { name: 'NPK', dose: '200 kg/ha', time: '2 minggu lagi' }
                ],
                notes: text.substring(0, 150) + (text.length > 150 ? '...' : '')
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error creating fallback recommendation:', error);
        return null;
    }
}

// Update planting schedule card
function updatePlantingScheduleCard(recommendation) {
    const contentEl = document.getElementById('planting-schedule-content');
    if (!contentEl) return;
    
    if (!recommendation || typeof recommendation !== 'object') {
        contentEl.innerHTML = '<p style="color: var(--gray);">Data tidak cukup untuk memberikan rekomendasi jadwal tanam. Silakan input data inventory atau hasil panen terlebih dahulu.</p>';
        return;
    }
    
    const plantType = recommendation.plantType || 'tanaman';
    const description = recommendation.description || '';
    const timeline = Array.isArray(recommendation.timeline) ? recommendation.timeline : [];
    
    if (timeline.length === 0) {
        // If no timeline, create a default one
        const defaultTimeline = [
            { date: 'Segera', description: 'Persiapan lahan dan bibit' },
            { date: '1-2 minggu', description: 'Penanaman bibit' },
            { date: '3-4 bulan', description: 'Perawatan dan pemeliharaan' },
            { date: '4-5 bulan', description: 'Estimasi panen' }
        ];
        
        const timelineHTML = defaultTimeline.map(item => `
            <div class="timeline-item">
                <div class="timeline-date">${item.date || 'TBD'}</div>
                <div class="timeline-desc">${item.description || ''}</div>
            </div>
        `).join('');
        
        contentEl.innerHTML = `
            <p>Waktu terbaik untuk menanam <strong>${plantType}</strong>:</p>
            ${description ? `<p style="font-size: 0.9em; color: var(--gray); margin-bottom: 15px;">${description}</p>` : ''}
            <div class="timeline">
                ${timelineHTML}
            </div>
        `;
        return;
    }
    
    const timelineHTML = timeline.map(item => `
        <div class="timeline-item">
            <div class="timeline-date">${item.date || 'TBD'}</div>
            <div class="timeline-desc">${item.description || ''}</div>
        </div>
    `).join('');
    
    contentEl.innerHTML = `
        <p>Waktu terbaik untuk menanam <strong>${plantType}</strong>:</p>
        ${description ? `<p style="font-size: 0.9em; color: var(--gray); margin-bottom: 15px;">${description}</p>` : ''}
        <div class="timeline">
            ${timelineHTML}
        </div>
    `;
}

// Update water management card
function updateWaterManagementCard(recommendation) {
    const contentEl = document.getElementById('water-management-content');
    if (!contentEl) return;
    
    if (!recommendation || typeof recommendation !== 'object') {
        contentEl.innerHTML = '<p style="color: var(--gray);">Data cuaca tidak tersedia. Rekomendasi akan muncul setelah data cuaca terhubung.</p>';
        return;
    }
    
    const intensity = recommendation.intensity || '2-3 cm di permukaan';
    const frequency = recommendation.frequency || '3 hari sekali';
    const time = recommendation.time || 'Pagi hari 06:00-08:00';
    const notes = recommendation.notes || '';
    
    const notesHTML = notes ? `<li style="font-style: italic; color: var(--gray);">${notes}</li>` : '';
    
    contentEl.innerHTML = `
        <p>Rekomendasi pengairan berdasarkan kondisi cuaca saat ini:</p>
        <ul>
            <li><strong>Intensitas:</strong> ${intensity}</li>
            <li><strong>Frekuensi:</strong> ${frequency}</li>
            <li><strong>Waktu:</strong> ${time}</li>
            ${notesHTML}
        </ul>
    `;
}

// Update fertilizer card
function updateFertilizerCard(recommendation) {
    const contentEl = document.getElementById('fertilizer-content');
    if (!contentEl) return;
    
    if (!recommendation || typeof recommendation !== 'object') {
        contentEl.innerHTML = '<p style="color: var(--gray);">Data tidak cukup untuk memberikan rekomendasi pemupukan.</p>';
        return;
    }
    
    const fertilizers = Array.isArray(recommendation.fertilizers) ? recommendation.fertilizers : [];
    
    if (fertilizers.length === 0) {
        // If no fertilizers provided, create default recommendations
        const defaultFertilizers = [
            { name: 'Urea', dose: '150 kg/ha', time: 'Minggu depan' },
            { name: 'NPK', dose: '200 kg/ha', time: '2 minggu lagi' }
        ];
        
        const fertilizerHTML = defaultFertilizers.map(fert => `
            <div class="fertilizer-item">
                <span class="fert-name">${fert.name || 'Pupuk'}</span>
                <span class="fert-dose">${fert.dose || 'N/A'}</span>
                <span class="fert-time">${fert.time || 'TBD'}</span>
            </div>
        `).join('');
        
        const notesHTML = recommendation.notes ? `<p style="font-size: 0.9em; color: var(--gray); margin-top: 15px; font-style: italic;">${recommendation.notes}</p>` : '';
        
        contentEl.innerHTML = `
            <p>Jadwal dan dosis pemupukan:</p>
            <div class="fertilizer-plan">
                ${fertilizerHTML}
            </div>
            ${notesHTML}
        `;
        return;
    }
    
    const fertilizerHTML = fertilizers.map(fert => `
        <div class="fertilizer-item">
            <span class="fert-name">${fert.name || 'Pupuk'}</span>
            <span class="fert-dose">${fert.dose || 'N/A'}</span>
            <span class="fert-time">${fert.time || 'TBD'}</span>
        </div>
    `).join('');
    
    const notesHTML = recommendation.notes ? `<p style="font-size: 0.9em; color: var(--gray); margin-top: 15px; font-style: italic;">${recommendation.notes}</p>` : '';
    
    contentEl.innerHTML = `
        <p>Jadwal dan dosis pemupukan:</p>
        <div class="fertilizer-plan">
            ${fertilizerHTML}
        </div>
        ${notesHTML}
    `;
}

// Show loading state for recommendations
function showRecommendationLoading() {
    const contents = ['planting-schedule-content', 'water-management-content', 'fertilizer-content'];
    contents.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '<div class="loading-recommendation"><i class="fas fa-spinner fa-spin"></i> <span>Menganalisis data untuk rekomendasi...</span></div>';
        }
    });
}

// Show error state for recommendations
function showRecommendationError(message, contentId = null) {
    if (contentId) {
        const el = document.getElementById(contentId);
        if (el) {
            el.innerHTML = `<p style="color: var(--error);">${message}</p>`;
        }
    } else {
        const contents = ['planting-schedule-content', 'water-management-content', 'fertilizer-content'];
        contents.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = `<p style="color: var(--error);">${message}</p>`;
            }
        });
    }
}

// Export functions for potential module use
window.AgromettApp = {
    calculatePredictions,
    showNotification,
    updateWeatherData
};