// Firebase Configuration - Using dynamic import for better compatibility
let firebaseApp, auth, googleProvider;

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDxaKXr0k1k93N1Yhr3WM1uAeh5Kynpcrs",
    authDomain: "agromett-id.firebaseapp.com",
    projectId: "agromett-id",
    storageBucket: "agromett-id.firebasestorage.app",
    messagingSenderId: "1052405028336",
    appId: "1:1052405028336:web:76f8896eb4e1d91c19f935"
};

// Initialize Firebase (lazy initialization)
let db; // Firestore database instance
let realtimeDb; // Realtime Database instance

async function initFirebase() {
    if (auth) return auth;
    
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
    const { getAuth, GoogleAuthProvider } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const { getDatabase } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
    
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    realtimeDb = getDatabase(firebaseApp, "https://agromett-id-default-rtdb.asia-southeast1.firebasedatabase.app");
    googleProvider = new GoogleAuthProvider();
    
    return auth;
}

// Save user data to Firestore (NOT localStorage)
async function saveUserToFirestore(user) {
    try {
        await initFirebase();
        const { doc, setDoc, getDoc, serverTimestamp, Timestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        // Check if user document exists
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        const now = serverTimestamp();
        const userData = {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            photoURL: user.photoURL || '',
            providerId: user.providerData?.[0]?.providerId || 'email',
            lastLoginAt: now,
            emailVerified: user.emailVerified || false
        };
        
        // If user doesn't exist, set createdAt
        if (!userSnap.exists()) {
            userData.createdAt = now;
            console.log('Creating new user document in Firestore:', user.uid);
        } else {
            // Preserve createdAt if exists
            const existingData = userSnap.data();
            if (existingData.createdAt) {
                userData.createdAt = existingData.createdAt;
            } else {
                userData.createdAt = now;
            }
            console.log('Updating existing user document in Firestore:', user.uid);
        }
        
        // Save to Firestore users collection
        await setDoc(userRef, userData, { merge: true });
        
        console.log('User data saved to Firestore successfully:', user.uid);
        return userData;
    } catch (error) {
        console.error('Error saving user to Firestore:', error);
        // Don't throw error, just log it so login can continue
        return null;
    }
}

// Update last login timestamp
async function updateLastLogin(userId) {
    try {
        await initFirebase();
        const { doc, updateDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            lastLoginAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating last login:', error);
    }
}

// Get user data from Firestore
async function getUserFromFirestore(userId) {
    try {
        await initFirebase();
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            return userSnap.data();
        } else {
            console.log('User document does not exist in Firestore');
            return null;
        }
    } catch (error) {
        console.error('Error getting user from Firestore:', error);
        throw error;
    }
}

// Protected routes that require authentication
const protectedRoutes = [
    'dashboard.html',
    'input-data.html',
    'ai-rekomendasi.html',
    'riwayat.html',
    'account.html'
];

// Get current page
function getCurrentPage() {
    return window.location.pathname.split('/').pop() || 'dashboard.html';
}

// Check if current page is protected
function isProtectedRoute() {
    const currentPage = getCurrentPage();
    return protectedRoutes.includes(currentPage);
}

// Sign in with Google
export async function signInWithGoogle() {
    try {
        await initFirebase();
        const { signInWithPopup } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const result = await signInWithPopup(auth, googleProvider);
        
        // Save user data to Firestore (NOT localStorage)
        await saveUserToFirestore(result.user);
        
        return result.user;
    } catch (error) {
        console.error('Error signing in with Google:', error);
        throw error;
    }
}

// Sign in with Email and Password
export async function signInWithEmailPassword(email, password) {
    try {
        await initFirebase();
        const { signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const result = await signInWithEmailAndPassword(auth, email, password);
        
        // Update last login timestamp in Firestore
        await updateLastLogin(result.user.uid);
        
        return result.user;
    } catch (error) {
        console.error('Error signing in with email:', error);
        throw error;
    }
}

// Create user with Email and Password
export async function createUserWithEmailPassword(name, email, password) {
    try {
        await initFirebase();
        const { createUserWithEmailAndPassword, updateProfile } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const result = await createUserWithEmailAndPassword(auth, email, password);
        
        // Update user profile with display name
        await updateProfile(result.user, {
            displayName: name
        });
        
        // Save user data to Firestore (NOT localStorage)
        await saveUserToFirestore(result.user);
        
        return result.user;
    } catch (error) {
        console.error('Error creating user:', error);
        throw error;
    }
}

// Sign out
export async function signOut() {
    try {
        await initFirebase();
        
        // Clear any potential localStorage/sessionStorage data first
        if (typeof Storage !== 'undefined') {
            try {
                localStorage.clear();
                sessionStorage.clear();
            } catch (e) {
                console.log('Error clearing storage:', e);
            }
        }
        
        // Sign out from Firebase Auth
        const { signOut: firebaseSignOut } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        
        if (auth) {
            await firebaseSignOut(auth);
            console.log('User signed out successfully');
        } else {
            console.warn('Auth instance not initialized');
        }
        
        return true;
    } catch (error) {
        console.error('Error signing out:', error);
        // Even if there's an error, try to clear storage and redirect
        if (typeof Storage !== 'undefined') {
            try {
                localStorage.clear();
                sessionStorage.clear();
            } catch (e) {
                // Ignore
            }
        }
        throw error;
    }
}

// Get current user
export async function getCurrentUser() {
    await initFirebase();
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

// Protect routes - redirect to auth.html if not authenticated
export async function protectRoute() {
    await initFirebase();
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    onAuthStateChanged(auth, (user) => {
        if (isProtectedRoute()) {
            if (!user) {
                // User is not authenticated, redirect to auth page
                window.location.href = 'auth.html';
            }
        } else if (user && getCurrentPage() === 'auth.html') {
            // User is authenticated but on auth page, redirect to dashboard
            window.location.href = 'dashboard.html';
        }
    });
}

// Initialize route protection on page load
if (typeof window !== 'undefined') {
    protectRoute();
}

// Monitor auth state and save to Firestore (NOT localStorage)
export async function setupAuthStateListener() {
    await initFirebase();
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in - save to Firestore
            try {
                await saveUserToFirestore(user);
            } catch (error) {
                console.error('Error saving user on auth state change:', error);
            }
        } else {
            // User is signed out - ensure no localStorage data
            if (typeof Storage !== 'undefined') {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                } catch (e) {
                    // Ignore errors
                }
            }
        }
    });
}

// Initialize auth state listener
if (typeof window !== 'undefined') {
    setupAuthStateListener();
}

// Save prediction to Firestore (as subcollection in users collection)
export async function savePredictionToFirestore(userId, predictionData) {
    try {
        await initFirebase();
        const { collection, doc, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        // Prepare prediction data for Firestore
        const predictionRecord = {
            // Input data
            plantType: predictionData.plantType || '',
            landArea: predictionData.landArea || 0,
            growthPhase: predictionData.growthPhase || '',
            soilType: predictionData.soilType || '',
            // Prediction results
            productivity: predictionData.productivity || 0,
            revenue: predictionData.revenue || 0,
            harvestDate: predictionData.harvestDate ? new Date(predictionData.harvestDate) : null,
            yieldComparison: predictionData.yieldComparison || 0,
            accuracy: predictionData.accuracy || 85,
            // Timestamps
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        
        // Save to subcollection: users/{userId}/predictions
        const userRef = doc(db, 'users', userId);
        const predictionsRef = collection(userRef, 'predictions');
        const docRef = await addDoc(predictionsRef, predictionRecord);
        
        console.log('Prediction saved to Firestore successfully:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving prediction to Firestore:', error);
        throw error;
    }
}

// Get user predictions from Firestore (from subcollection in users collection)
export async function getUserPredictions(userId, limitCount = 50) {
    try {
        await initFirebase();
        const firestoreModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const { collection, doc, query, orderBy, limit, getDocs } = firestoreModule;
        
        // Get from subcollection: users/{userId}/predictions
        const userRef = doc(db, 'users', userId);
        const predictionsRef = collection(userRef, 'predictions');
        const q = query(
            predictionsRef,
            orderBy('createdAt', 'desc'),
            limit(limitCount)
        );
        
        const querySnapshot = await getDocs(q);
        const predictions = [];
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            predictions.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.() || null,
                updatedAt: data.updatedAt?.toDate?.() || null,
                harvestDate: data.harvestDate?.toDate?.() || null
            });
        });
        
        return predictions;
    } catch (error) {
        console.error('Error getting user predictions:', error);
        throw error;
    }
}

// Get Realtime Database instance
export async function getRealtimeDatabase() {
    await initFirebase();
    return realtimeDb;
}

// Subscribe to real-time weather data from sensor/last
export async function subscribeToWeatherData(callback) {
    try {
        await initFirebase();
        const { ref, onValue } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js");
        
        // Read from sensor/last path
        const sensorRef = ref(realtimeDb, 'sensor/last');
        
        // Subscribe to changes
        const unsubscribe = onValue(sensorRef, (snapshot) => {
            const data = snapshot.val();
            if (data && callback) {
                callback(data);
            }
        }, (error) => {
            console.error('Error reading sensor data:', error);
            if (callback) {
                callback(null, error);
            }
        });
        
        return unsubscribe;
    } catch (error) {
        console.error('Error setting up sensor subscription:', error);
        throw error;
    }
}

// Save inventory to Firestore (as subcollection in users collection)
export async function saveInventoryToFirestore(userId, inventoryData) {
    try {
        await initFirebase();
        const { collection, doc, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        // Prepare inventory data for Firestore
        const inventoryRecord = {
            plantType: inventoryData.plantType || '',
            quantity: inventoryData.quantity || 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        
        // Save to subcollection: users/{userId}/inventory
        const userRef = doc(db, 'users', userId);
        const inventoryRef = collection(userRef, 'inventory');
        const docRef = await addDoc(inventoryRef, inventoryRecord);
        
        console.log('Inventory saved to Firestore successfully:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving inventory to Firestore:', error);
        throw error;
    }
}

// Get user inventory from Firestore
export async function getUserInventory(userId, limitCount = 100) {
    try {
        await initFirebase();
        const firestoreModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const { collection, doc, query, orderBy, limit, getDocs } = firestoreModule;
        
        // Get from subcollection: users/{userId}/inventory
        const userRef = doc(db, 'users', userId);
        const inventoryRef = collection(userRef, 'inventory');
        const q = query(
            inventoryRef,
            orderBy('createdAt', 'desc'),
            limit(limitCount)
        );
        
        const querySnapshot = await getDocs(q);
        const inventory = [];
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            inventory.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.() || null,
                updatedAt: data.updatedAt?.toDate?.() || null
            });
        });
        
        return inventory;
    } catch (error) {
        console.error('Error getting user inventory:', error);
        throw error;
    }
}

// Save harvest to Firestore (as subcollection in users collection)
export async function saveHarvestToFirestore(userId, harvestData) {
    try {
        await initFirebase();
        const { collection, doc, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        
        // Prepare harvest data for Firestore
        const harvestRecord = {
            plantType: harvestData.plantType || '',
            harvestDate: harvestData.harvestDate ? new Date(harvestData.harvestDate) : null,
            yield: harvestData.yield || 0, // ton/ha
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        
        // Save to subcollection: users/{userId}/harvests
        const userRef = doc(db, 'users', userId);
        const harvestsRef = collection(userRef, 'harvests');
        const docRef = await addDoc(harvestsRef, harvestRecord);
        
        console.log('Harvest saved to Firestore successfully:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving harvest to Firestore:', error);
        throw error;
    }
}

// Get user harvests from Firestore
export async function getUserHarvests(userId, limitCount = 100) {
    try {
        await initFirebase();
        const firestoreModule = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
        const { collection, doc, query, orderBy, limit, getDocs } = firestoreModule;
        
        // Get from subcollection: users/{userId}/harvests
        const userRef = doc(db, 'users', userId);
        const harvestsRef = collection(userRef, 'harvests');
        const q = query(
            harvestsRef,
            orderBy('harvestDate', 'desc'),
            limit(limitCount)
        );
        
        const querySnapshot = await getDocs(q);
        const harvests = [];
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            harvests.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate?.() || null,
                updatedAt: data.updatedAt?.toDate?.() || null,
                harvestDate: data.harvestDate?.toDate?.() || null
            });

        });
        
        return harvests;
    } catch (error) {
        console.error('Error getting user harvests:', error);
        throw error;
    }
}

// Export functions for use in other modules
export { initFirebase, getUserFromFirestore };


