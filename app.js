// app.js - Metube एप्लिकेशन का मुख्य लॉजिक

// Firestore, Storage, Auth के आवश्यक आयात
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, query, limit, getDocs, onSnapshot, orderBy, addDoc, doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// =============================================================
// 1. ग्लोबल वैरिएबल्स और स्टेट
// =============================================================

// ये वैरिएबल्स index.html से initMetubeApp के माध्यम से सेट किए जाएंगे
let METUBE_APP_ID;
let AUTH_SERVICE;
let DB_SERVICE;
let STORAGE_SERVICE;

let currentUser = null; 
let currentPage = 'homePage';
let lastVisible = null; // Pagination के लिए
const VIDEOS_COLLECTION = 'videos'; // Firestore Collection

// UI Elements (index.html से ID द्वारा एक्सेस)
const appContainer = document.getElementById('appContainer');
const loadingScreen = document.getElementById('loadingScreen');
const videosGrid = document.getElementById('videosGrid');
const loadingVideos = document.getElementById('loadingVideos');

// Upload UI Elements
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const uploadSpeed = document.getElementById('uploadSpeed');
const uploadForm = document.getElementById('uploadForm');


// =============================================================
// 2. यूटिलिटी फ़ंक्शंस (मददगार फ़ंक्शंस)
// =============================================================

/**
 * दिनांक को पढ़ने में आसान प्रारूप में बदलता है।
 */
function formatTimeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) { return Math.floor(interval) + " साल पहले"; }
    interval = seconds / 2592000;
    if (interval > 1) { return Math.floor(interval) + " महीने पहले"; }
    interval = seconds / 86400;
    if (interval > 1) { return Math.floor(interval) + " दिन पहले"; }
    interval = seconds / 3600;
    if (interval > 1) { return Math.floor(interval) + " घंटे पहले"; }
    interval = seconds / 60;
    if (interval > 1) { return Math.floor(interval) + " मिनट पहले"; }
    return Math.floor(seconds) + " सेकंड पहले";
}

/**
 * संख्या को K, M, B प्रारूप में बदलता है।
 */
function formatNumber(num) {
    if (num >= 1000000) { return (num / 1000000).toFixed(1) + 'M'; }
    if (num >= 1000) { return (num / 1000).toFixed(0) + 'K'; }
    return num;
}


// =============================================================
// 3. UI/नेविगेशन फ़ंक्शंस
// =============================================================

/**
 * साइडबार को टॉगल करता है (खोलना/बंद करना)।
 */
export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

/**
 * पेज बदलता है और UI को अपडेट करता है।
 */
export function showPage(pageId) {
    // सभी पेजों को छुपाएँ
    document.querySelectorAll('.page').forEach(page => {
        page.style.display = 'none';
        page.classList.remove('active');
    });

    // केवल चुने हुए पेज को दिखाएँ
    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.style.display = 'block';
        activePage.classList.add('active');
        currentPage = pageId;

        // नेविगेशन लिंक्स को अपडेट करें
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // साइडबार/बॉटम नेव में सक्रिय लिंक को हाइलाइट करें (केवल होम/ट्रेंडिंग/सब्सक्रिप्शन के लिए)
        if (pageId === 'homePage') {
            document.querySelector('.sidebar-nav a[onclick*="homePage"]').classList.add('active');
            document.querySelector('.bottom-nav a[onclick*="homePage"]').classList.add('active');
        } else if (pageId === 'trendingPage') {
            document.querySelector('.sidebar-nav a[onclick*="trendingPage"]').classList.add('active');
            document.querySelector('.bottom-nav a[onclick*="trendingPage"]').classList.add('active');
        } else if (pageId === 'subscriptionsPage') {
            document.querySelector('.sidebar-nav a[onclick*="subscriptionsPage"]').classList.add('active');
            document.querySelector('.bottom-nav a[onclick*="subscriptionsPage"]').classList.add('active');
        }
        
    } else {
        console.error(`Page ID '${pageId}' not found.`);
    }
}


// =============================================================
// 4. Firebase Auth
// =============================================================

/**
 * Auth स्टेट Listener सेट करता है।
 */
function setupAuthListener() {
    onAuthStateChanged(AUTH_SERVICE, (user) => {
        if (user) {
            currentUser = user;
            console.log("User is signed in:", currentUser.uid);
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('loggedUser').style.display = 'flex';
            // Avatar Placeholder: Anonymous users are named 'Guest'
            const initials = 'G'; // Simplified for anonymous
            document.getElementById('userAvatar').src = `https://placehold.co/36x36/888/fff?text=${initials}`;
        } else {
            currentUser = null;
            console.log("User is signed out.");
            document.getElementById('loginBtn').style.display = 'flex';
            document.getElementById('loggedUser').style.display = 'none';
        }
    });
}


// =============================================================
// 5. Firestore Data Handling
// =============================================================

/**
 * वीडियो कार्ड HTML जेनरेट करता है।
 */
function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => playVideo(video.id, video); // प्ले वीडियो इवेंट
    
    // Firestore Timestamp को Date ऑब्जेक्ट में बदलें
    const uploadDate = video.timestamp.toDate ? video.timestamp.toDate() : new Date(video.timestamp);
    
    card.innerHTML = `
        <div class="thumbnail-container">
            <img src="${video.thumbnailUrl || 'https://placehold.co/480x270/0f0f0f/fff?text=No+Thumbnail'}" alt="${video.title}" class="thumbnail">
            <span class="video-duration">10:45</span>
        </div>
        <div class="video-details">
            <img src="https://placehold.co/36x36/ff0000/fff?text=C" alt="चैनल" class="channel-avatar">
            <div class="details-text">
                <h3 class="video-title-card">${video.title}</h3>
                <p class="channel-name">User: ${video.userId.substring(0, 8)}...</p>
                <p class="video-stats">${formatNumber(video.views)} दृश्य • ${formatTimeSince(uploadDate)}</p>
            </div>
        </div>
    `;
    return card;
}

/**
 * Firestore से वीडियो लोड करता है और onSnapshot लिसनर सेट करता है।
 */
export function loadVideos() {
    if (!DB_SERVICE || !METUBE_APP_ID) return;

    videosGrid.innerHTML = ''; // ग्रिड को साफ करें
    loadingVideos.style.display = 'block';

    const videosRef = collection(DB_SERVICE, 'artifacts', METUBE_APP_ID, 'public', 'data', VIDEOS_COLLECTION);
    
    // सभी वीडियो को लोड करने के लिए एक query सेट करें
    // Sorting (orderBy) को हटा दिया गया है ताकि Indexing errors न आएं, लेकिन data को Javascript में sort कर सकते हैं
    const q = query(videosRef); 

    // onSnapshot: रियल-टाइम अपडेट के लिए
    onSnapshot(q, (snapshot) => {
        const videoList = [];
        snapshot.forEach((doc) => {
            // DocumentSnapshot को डेटा ऑब्जेक्ट में बदलें
            videoList.push({ id: doc.id, ...doc.data() });
        });

        // वीडियो को अपलोड टाइम के हिसाब से Javascript में Sort करें (ताज़ा पहले)
        videoList.sort((a, b) => {
            const dateA = a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            const dateB = b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
            return dateB - dateA;
        });

        videosGrid.innerHTML = ''; // ग्रिड को फिर से साफ करें
        if (videoList.length === 0) {
            videosGrid.innerHTML = '<p class="no-videos">कोई वीडियो उपलब्ध नहीं है। अपलोड करने वाले पहले व्यक्ति बनें!</p>';
        } else {
            videoList.forEach(video => {
                videosGrid.appendChild(createVideoCard(video));
            });
        }
        loadingVideos.style.display = 'none';
        console.log(`Loaded ${videoList.length} videos from Firestore.`);
    }, (error) => {
        console.error("Firestore onSnapshot failed:", error);
        loadingVideos.textContent = 'वीडियो लोड करने में त्रुटि आई।';
    });
}


// =============================================================
// 6. VIDEO UPLOAD (सबसे महत्वपूर्ण फिक्स)
// =============================================================

/**
 * वीडियो अपलोड शुरू करता है और प्रगति को ट्रैक करता है।
 * यह फ़ंक्शन index.html से Form onsubmit पर कॉल होता है।
 * @param {Event} e - फॉर्म सबमिट इवेंट
 * @param {File} fileToUpload - वीडियो फ़ाइल ऑब्जेक्ट (index.html से global state)
 */
export async function uploadVideo(e, fileToUpload) {
    e.preventDefault(); // फॉर्म को रीलोड होने से रोकें
    
    // 1. प्री-चेक्स
    if (!fileToUpload) {
        // alert के बजाय कंसोल में लॉग करें
        console.error('कृपया अपलोड करने के लिए एक वीडियो फ़ाइल चुनें!');
        progressText.textContent = 'त्रुटि: कृपया एक वीडियो फ़ाइल चुनें!';
        return;
    }

    if (fileToUpload.size > 100 * 1024 * 1024) { // 100MB सीमा
        console.error('फ़ाइल का आकार 100MB से अधिक है।');
        progressText.textContent = 'त्रुटि: फ़ाइल 100MB से बड़ी है।';
        return;
    }

    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;
    
    const userId = AUTH_SERVICE.currentUser ? AUTH_SERVICE.currentUser.uid : 'anonymous';
    
    // 2. स्टोरेज पाथ परिभाषित करें
    const storagePath = `videos/${userId}/${Date.now()}_${fileToUpload.name}`;
    const storageRef = ref(STORAGE_SERVICE, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, fileToUpload);
    
    let startTime = Date.now();
    
    // 3. अपलोड प्रगति को ट्रैक करें (uploadTask.on)
    uploadTask.on('state_changed', 
        (snapshot) => {
            // प्रगति अपडेट
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            const transferredMB = (snapshot.bytesTransferred / 1024 / 1024).toFixed(2);
            const totalMB = (snapshot.totalBytes / 1024 / 1024).toFixed(2);
            
            // गति गणना
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const speedKBps = (snapshot.bytesTransferred / elapsedSeconds / 1024).toFixed(1);

            progressFill.style.width = progress + '%';
            progressText.textContent = `अपलोड हो रहा है: ${progress.toFixed(0)}% (${transferredMB} MB of ${totalMB} MB)`;
            uploadSpeed.textContent = `${speedKBps} KB/s`;
        }, 
        (error) => {
            // अपलोड में त्रुटि
            console.error("Upload failed:", error);
            progressText.textContent = 'अपलोड विफल: ' + error.message;
            // UI को रीसेट करें
            progressFill.style.width = '0%';
            uploadSpeed.textContent = '';
        }, 
        async () => {
            // 4. अपलोड सफल हुआ
            try {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                
                // 5. Firestore में मेटाडेटा सेव करें
                const newVideoRef = collection(DB_SERVICE, 'artifacts', METUBE_APP_ID, 'public', 'data', VIDEOS_COLLECTION);
                
                await addDoc(newVideoRef, {
                    userId: userId,
                    title: title,
                    description: description,
                    category: category,
                    url: downloadURL,
                    storagePath: storagePath,
                    thumbnailUrl: `https://placehold.co/480x270/ff0000/fff?text=${title.substring(0, 10)}`, // डमी थंबनेल
                    views: 0,
                    likes: 0,
                    timestamp: new Date()
                });

                console.log('वीडियो सफलतापूर्वक अपलोड और प्रकाशित हो गया!');
                
                // 6. UI रीसेट
                uploadForm.reset();
                progressFill.style.width = '0%';
                progressText.textContent = 'अपलोड सफल!';
                uploadSpeed.textContent = 'डेटाबेस में सहेजा गया।';
                
                // फ़ाइल इनपुट स्टेट को रीसेट करें
                window.selectedFile = null;
                document.getElementById('fileNameDisplay').textContent = 'कोई फ़ाइल नहीं चुनी गई।';
                document.getElementById('uploadDetails').style.display = 'none';

                // Home Page पर वापस जाएँ (थोड़ी देर बाद)
                setTimeout(() => showPage('homePage'), 2000);
                
            } catch (firestoreError) {
                console.error("Failed to save metadata to Firestore:", firestoreError);
                progressText.textContent = 'अपलोड सफल, पर डेटाबेस त्रुटि: ' + firestoreError.message;
            }
        }
    );
}


// =============================================================
// 7. Initialization (एप्लिकेशन शुरू करना)
// =============================================================

/**
 * एप्लिकेशन को शुरू करने के लिए मुख्य फ़ंक्शन
 */
export function initMetubeApp(appId, auth, db, storage) {
    METUBE_APP_ID = appId;
    AUTH_SERVICE = auth;
    DB_SERVICE = db;
    STORAGE_SERVICE = storage;

    // 1. ऑथेंटिकेशन लिसनर सेट करें
    setupAuthListener();

    // 2. होम पेज के वीडियो लोड करें (onSnapshot इसे रियल-टाइम में हैंडल करेगा)
    // Auth State change होने के बाद यह फिर से चलेगा
    loadVideos(); 
}

// अन्य फ़ंक्शंस (likeVideo, searchVideos, playVideo) को आप यहाँ जोड़ सकते हैं
// अभी के लिए वे डमी रहेंगे
export function playVideo(videoId, videoData) {
    console.log('Playing video:', videoId, videoData.title);
    // यहां वीडियो प्लेयर UI अपडेट करने का लॉजिक आएगा
    showPage('playerPage'); 
}
export function likeVideo(videoId) { console.log(`Video ${videoId} liked! (Not yet functional)`); }
export function searchVideos() { console.log('Searching...'); }

