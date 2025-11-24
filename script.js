// Global variables
let currentSection = 'dashboard';
let weatherData = [];
let harvestData = [];
let currentPrediction = null; // Store current prediction data

// Gemini readiness cache & configuration
let geminiStatusChecked = false;
let geminiIsReady = false;
let geminiAvailableModels = [];
const GEMINI_API_KEY = 'AIzaSyB_LrfNSRdHRarokIAjEsOahfSkshSeWXM';
const GEMINI_MODEL_FALLBACKS = [
    'models/gemini-2.5-flash',
    'models/gemini-2.5-pro',
    'models/gemini-2.5-flash-lite',
    'models/gemini-2.5-flash-preview-05-20',
    'models/gemini-2.0-flash',
    'models/gemini-pro-latest',
    'models/gemini-flash-latest',
    'models/gemini-2.5-flash-preview-05-20',
    'models/gemini-2.5-pro-preview-05-06'
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
    
    // Check connection status
    checkConnectionStatus();
    
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
        subscribeToRealtimeWeather();
    }
    
    // Start periodic updates
    setInterval(updateDateTime, 60000); // Update time every minute
    setInterval(checkConnectionStatus, 30000); // Check connection every 30 seconds
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
    
    const ready = await ensureGeminiReady(GEMINI_API_KEY);
    if (!ready) {
        console.warn('Gemini readiness check did not confirm availability. Continuing with fallback models...');
    }
    
    const modelCandidates = [...(geminiAvailableModels || []), ...GEMINI_MODEL_FALLBACKS]
        .filter(name => name && name.includes('gemini'))
        .filter((name, index, arr) => arr.indexOf(name) === index);
    
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
        let lastError = null;

        for (const modelName of modelCandidates) {
            const endpointVariants = [
                `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
                `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${GEMINI_API_KEY}`
            ];

            for (const endpoint of endpointVariants) {
                try {
                    console.log(`Attempting Gemini API call: model=${modelName}, endpoint=${endpoint.replace(GEMINI_API_KEY, 'API_KEY_HIDDEN')}`);
                    
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
                        if ([404, 500, 502, 503, 504, 429].includes(response.status)) {
                            const errorData = await response.json().catch(() => ({}));
                            lastError = new Error(errorData.error?.message || `HTTP ${response.status}`);
                            console.warn(`Model ${modelName} not available (status ${response.status}). Trying next option...`);
                            continue;
                        }
                        const errorData = await response.json().catch(() => ({}));
                        lastError = new Error(errorData.error?.message || `HTTP ${response.status}`);
                        break;
                    }

                    const data = await response.json();
                    console.log('Gemini raw response:', data);
                    
                    const candidate = data.candidates?.[0];
                    if (!candidate) {
                        lastError = new Error('AI Gemini tidak mengembalikan kandidat jawaban');
                        continue;
                    }
                    
                    const responseText = extractGeminiText(candidate).trim();
                    if (!responseText) {
                        console.warn('Candidate data with no text payload:', candidate);
                        lastError = new Error('AI Gemini mengembalikan format response yang tidak valid');
                        continue;
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
                    
                    try {
                        const aiResult = JSON.parse(jsonText);
                        
                        if (typeof aiResult.productivity === 'undefined' || 
                            typeof aiResult.revenue === 'undefined' ||
                            typeof aiResult.harvestDays === 'undefined') {
                            lastError = new Error('AI Gemini tidak mengembalikan semua data yang diperlukan');
                            continue;
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
                        
                        console.log(`Gemini API call succeeded with model ${modelName}`);
                        console.log('Parsed AI Result:', result);
                        return result;
                    } catch (parseError) {
                        console.error('JSON Parse Error:', parseError);
                        console.error('JSON Text:', jsonText);
                        lastError = new Error('AI Gemini mengembalikan data yang tidak dapat diproses');
                        continue;
                    }
                } catch (err) {
                    lastError = err;
                }
            }
        }

        console.error('API Error Response:', lastError);
        const errorMessage = lastError?.message || 'Unknown AI error';
        
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
}

// Export Handler
function handleExport(e) {
    const format = e.currentTarget.textContent.includes('PDF') ? 'PDF' : 'Excel';
    showNotification(`Mengekspor data dalam format ${format}...`, 'info');
    
    // Simulate export process
    setTimeout(() => {
        showNotification(`Data berhasil diekspor dalam format ${format}`, 'success');
    }, 1500);
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

// Check Connection Status
let lastConnectionStatus = null;
let notificationTimeout = null;

function checkConnectionStatus() {
    const statusElement = document.getElementById('connection-status');
    if (!statusElement) return;
    
    const isOnline = navigator.onLine && Math.random() > 0.2; // 80% chance of being online
    
    // Show notification if status changed or on first load
    if (lastConnectionStatus === null || lastConnectionStatus !== isOnline) {
        lastConnectionStatus = isOnline;
        
        // Clear any existing timeout
        if (notificationTimeout) {
            clearTimeout(notificationTimeout);
        }
        
        // Remove previous classes and animations
        statusElement.classList.remove('show', 'offline');
        statusElement.style.animation = 'none';
        statusElement.style.opacity = '0';
        
        // Force reflow
        void statusElement.offsetWidth;
        
        if (isOnline) {
            statusElement.innerHTML = '<i class="fas fa-wifi"></i> Terhubung ke Cloud AGROMETT';
            statusElement.className = 'connection-status';
        } else {
            statusElement.innerHTML = '<i class="fas fa-wifi-slash"></i> Mode Offline - Data lokal';
            statusElement.className = 'connection-status offline';
        }
        
        // Show notification with animation
        setTimeout(() => {
            statusElement.classList.add('show');
            statusElement.style.opacity = '1';
            statusElement.style.animation = 'slideInRight 1s ease-out';
        }, 10);
        
        // Hide notification after 2 seconds (accounting for slide-in animation)
        notificationTimeout = setTimeout(() => {
            statusElement.classList.remove('show');
            statusElement.style.animation = 'fadeOut 0.6s ease-in forwards';
            setTimeout(() => {
                statusElement.style.opacity = '0';
            }, 600);
        }, 2500); // 1s animation + 2.5s display = 3.5s total
    }
}

// Subscribe to real-time weather data from Firebase Realtime Database
let weatherUnsubscribe = null;
let lastWeatherData = null;

async function subscribeToRealtimeWeather() {
    try {
        const { subscribeToWeatherData } = await import('./firebase-auth.js');
        
        weatherUnsubscribe = await subscribeToWeatherData((data, error) => {
            if (error) {
                console.error('Error receiving weather data:', error);
                // Fallback to simulated data if real-time fails
                updateWeatherDataFallback();
                return;
            }
            
            if (data) {
                updateWeatherDisplay(data);
                lastWeatherData = data;
            }
        });
        
        console.log('Subscribed to real-time weather data');
    } catch (error) {
        console.error('Error subscribing to weather data:', error);
        // Fallback to simulated data
        updateWeatherDataFallback();
    }
}

// Update weather display with real-time data
function updateWeatherDisplay(weatherData) {
    // Update temperature
    const tempEl = document.querySelector('.temperature .weather-value');
    if (tempEl && weatherData.temperature !== undefined) {
        const temp = parseFloat(weatherData.temperature);
        tempEl.textContent = `${temp.toFixed(1)}°C`;
        
        // Update trend (compare with last value)
        updateTrend('.temperature', lastWeatherData?.temperature, temp);
    }
    
    // Update humidity
    const humidityEl = document.querySelector('.humidity .weather-value');
    if (humidityEl && weatherData.humidity !== undefined) {
        const humidity = parseFloat(weatherData.humidity);
        humidityEl.textContent = `${humidity.toFixed(0)}%`;
        updateTrend('.humidity', lastWeatherData?.humidity, humidity);
    }
    
    // Update light intensity
    const lightEl = document.querySelector('.light .weather-value');
    if (lightEl && weatherData.light !== undefined) {
        const light = parseFloat(weatherData.light);
        lightEl.textContent = `${light.toFixed(0)} Lux`;
        updateTrend('.light', lastWeatherData?.light, light);
    }
    
    // Update wind speed
    const windEl = document.querySelector('.wind .weather-value');
    if (windEl && weatherData.wind !== undefined) {
        const wind = parseFloat(weatherData.wind);
        windEl.textContent = `${wind.toFixed(1)} km/jam`;
        updateTrend('.wind', lastWeatherData?.wind, wind);
    }
    
    // Update last update time
    updateDateTime();
    
    // Update charts if data changed significantly
    if (lastWeatherData) {
        updateCharts();
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
    
    // Yield Chart (only if element exists)
    const yieldChartEl = document.getElementById('yieldChart');
    if (yieldChartEl) {
        const yieldCtx = yieldChartEl.getContext('2d');
        window.yieldChart = new Chart(yieldCtx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
            datasets: [{
                label: 'Produktivitas (ton/ha)',
                data: [5.8, 5.9, 6.1, 6.0, 6.2, 6.3, 6.1, 6.4, 6.2, 6.5, 6.3, 6.6],
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
    }
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

// Export functions for potential module use
window.AgromettApp = {
    calculatePredictions,
    showNotification,
    updateWeatherData
};