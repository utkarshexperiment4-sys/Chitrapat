// app.js - Metube एप्लिकेशन का मुख्य लॉजिक

// Firestore, Storage, Auth के आवश्यक आयात
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, query, onSnapshot, addDoc, doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// =============================================================
// 1. ग्लोबल वैरिएबल्स और स्टेट
// =============================================================

let METUBE_APP_ID;
let AUTH_SERVICE;
let DB_SERVICE;
let STORAGE_SERVICE;

let currentUser = null; 
let currentFile = null; // **अपडेटेड: यह अब फाइल को स्टोर करेगा**

const VIDEOS_COLLECTION = 'videos';

// UI Elements (index.html से ID द्वारा एक्सेस)
const videosGrid = document.getElementById('videosGrid');
const loadingVideos = document.getElementById('loadingVideos');

// Upload UI Elements
const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const uploadDetails = document.getElementById('uploadDetails');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const uploadSpeed = document.getElementById('uploadSpeed');

// Player UI Elements
const mainVideoPlayer = document.getElementById('mainVideoPlayer');
const playerVideoTitle = document.getElementById('playerVideoTitle');
const playerVideoStats = document.getElementById('playerVideoStats');
const playerChannelName = document.getElementById('playerChannelName');
const playerVideoDescription = document.getElementById('playerVideoDescription');


// =============================================================
// 2. यूटिलिटी फ़ंक्शंस
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
    document.querySelectorAll('.page').forEach(page => {
        page.style.display = 'none';
        page.classList.remove('active');
    });

    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.style.display = 'block';
        activePage.classList.add('active');
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
            const initials = 'G'; 
            document.getElementById('userAvatar').src = `https://placehold.co/36x36/888/fff?text=${initials}`;

            // Auth के बाद वीडियो लोड करना शुरू करें
            loadVideos(); 

        } else {
            currentUser = null;
            console.log("User is signed out.");
            document.getElementById('loginBtn').style.display = 'flex';
            document.getElementById('loggedUser').style.display = 'none';
            
            // Login button पर इवेंट लिसनर (क्योंकि यह index.html में था)
            document.getElementById('loginBtn').addEventListener('click', async () => {
                await signInAnonymously(AUTH_SERVICE);
            });
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
    
    const uploadDate = video.timestamp.toDate ? video.timestamp.toDate() : new Date(video.timestamp);
    
    card.innerHTML = `
        <div class="thumbnail-container">
            <img src="${video.thumbnailUrl || 'https://placehold.co/480x270/0f0f0f/fff?text=Metube'}" alt="${video.title}" class="thumbnail">
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
function loadVideos() {
    if (!DB_SERVICE || !METUBE_APP_ID || !currentUser) return; // Auth के बाद ही चलाएं

    videosGrid.innerHTML = ''; 
    loadingVideos.style.display = 'block';

    const videosRef = collection(DB_SERVICE, 'artifacts', METUBE_APP_ID, 'public', 'data', VIDEOS_COLLECTION);
    const q = query(videosRef); 

    onSnapshot(q, (snapshot) => {
        const videoList = [];
        snapshot.forEach((doc) => {
            // views field को सुनिश्चित करें
            let data = doc.data();
            if (typeof data.views !== 'number') {
                 data.views = 0; // Default view count
            }
            videoList.push({ id: doc.id, ...data });
        });

        // वीडियो को अपलोड टाइम के हिसाब से Javascript में Sort करें (ताज़ा पहले)
        videoList.sort((a, b) => {
            const dateA = a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            const dateB = b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
            return dateB - dateA;
        });

        videosGrid.innerHTML = ''; 
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
// 6. VIDEO UPLOAD लॉजिक (नया इवेंट हैंडलिंग)
// =============================================================

/**
 * फ़ाइल इनपुट हैंडलर (जब फ़ाइल चुनी जाती है)
 */
function handleFileInputChange(e) {
    const file = e.target.files[0];
    if (file) {
        currentFile = file; // **फ़ाइल को ग्लोबल स्टेट में सेव करें**
        fileNameDisplay.textContent = `चुनी गई फ़ाइल: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        uploadDetails.style.display = 'block';
        // प्रगति बार रीसेट करें
        progressFill.style.width = '0%';
        progressText.textContent = 'प्रगति: 0%';
        uploadSpeed.textContent = '0 KB/s';
    } else {
        currentFile = null;
        fileNameDisplay.textContent = 'कोई फ़ाइल नहीं चुनी गई।';
        uploadDetails.style.display = 'none';
    }
}

/**
 * वीडियो अपलोड शुरू करता है और प्रगति को ट्रैक करता है।
 */
async function uploadVideo(e) {
    e.preventDefault(); 
    
    // 1. प्री-चेक्स
    if (!currentFile) {
        console.error('कृपया अपलोड करने के लिए एक वीडियो फ़ाइल चुनें!');
        progressText.textContent = 'त्रुटि: कृपया एक वीडियो फ़ाइल चुनें!';
        return;
    }

    if (currentFile.size > 100 * 1024 * 1024) { 
        console.error('फ़ाइल का आकार 100MB से अधिक है।');
        progressText.textContent = 'त्रुटि: फ़ाइल 100MB से बड़ी है।';
        return;
    }

    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;
    
    const userId = currentUser ? currentUser.uid : 'anonymous';
    
    // 2. स्टोरेज पाथ परिभाषित करें
    const storagePath = `videos/${userId}/${Date.now()}_${currentFile.name}`;
    const storageRef = ref(STORAGE_SERVICE, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, currentFile);
    
    let startTime = Date.now();
    
    // 3. अपलोड प्रगति को ट्रैक करें
    uploadTask.on('state_changed', 
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            const transferredMB = (snapshot.bytesTransferred / 1024 / 1024).toFixed(2);
            const totalMB = (snapshot.totalBytes / 1024 / 1024).toFixed(2);
            
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const speedKBps = (snapshot.bytesTransferred / elapsedSeconds / 1024).toFixed(1);

            progressFill.style.width = progress + '%';
            progressText.textContent = `अपलोड हो रहा है: ${progress.toFixed(0)}% (${transferredMB} MB of ${totalMB} MB)`;
            uploadSpeed.textContent = `${speedKBps} KB/s`;
        }, 
        (error) => {
            console.error("Upload failed:", error);
            progressText.textContent = 'अपलोड विफल: ' + error.message;
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
                    thumbnailUrl: `https://placehold.co/480x270/ff0000/fff?text=${title.substring(0, 10)}`, 
                    views: 0,
                    likes: 0,
                    timestamp: new Date()
                });

                console.log('वीडियो सफलतापूर्वक अपलोड और प्रकाशित हो गया!');
                
                // 6. UI रीसेट
                uploadForm.reset();
                currentFile = null;
                progressFill.style.width = '0%';
                progressText.textContent = 'अपलोड सफल!';
                uploadSpeed.textContent = 'डेटाबेस में सहेजा गया।';
                
                fileNameDisplay.textContent = 'कोई फ़ाइल नहीं चुनी गई।';
                uploadDetails.style.display = 'none';

                setTimeout(() => showPage('homePage'), 2000);
                
            } catch (firestoreError) {
                console.error("Failed to save metadata to Firestore:", firestoreError);
                progressText.textContent = 'अपलोड सफल, पर डेटाबेस त्रुटि: ' + firestoreError.message;
            }
        }
    );
}


// =============================================================
// 7. VIDEO PLAYER लॉजिक (पूरी तरह से कार्यान्वित)
// =============================================================

/**
 * किसी वीडियो को चलाने के लिए प्लेयर UI को अपडेट करता है और व्यू काउंट बढ़ाता है।
 */
export async function playVideo(videoId, videoData) {
    if (!DB_SERVICE || !METUBE_APP_ID) return;

    // 1. व्यू काउंट अपडेट करें (ट्रांजैक्शन का उपयोग नहीं किया गया है, साधारण इंक्रीमेंट)
    try {
        const videoDocRef = doc(DB_SERVICE, 'artifacts', METUBE_APP_ID, 'public', 'data', VIDEOS_COLLECTION, videoId);
        await updateDoc(videoDocRef, {
            views: increment(1)
        });
        console.log(`View count incremented for video ${videoId}`);
        // डेटा को तुरंत अपडेट करें (Real-time update onSnapshot द्वारा हैंडल किया जाएगा)
        videoData.views += 1; 
    } catch (e) {
        console.error("Error updating view count:", e);
    }
    
    // 2. प्लेयर UI अपडेट करें
    mainVideoPlayer.src = videoData.url;
    playerVideoTitle.textContent = videoData.title;
    playerVideoDescription.textContent = videoData.description;
    
    // डमी चैनल और स्टैट्स
    const uploadDate = videoData.timestamp.toDate ? videoData.timestamp.toDate() : new Date(videoData.timestamp);
    playerVideoStats.textContent = `${formatNumber(videoData.views)} दृश्य • ${formatTimeSince(uploadDate)}`;
    playerChannelName.textContent = `User: ${videoData.userId.substring(0, 10)}...`;

    // 3. प्लेयर पेज पर जाएँ
    showPage('playerPage');
}

/**
 * सर्च वीडियो लॉजिक (डमी)
 */
export function searchVideos() {
    const query = document.getElementById('searchInput').value;
    console.log(`Searching for: ${query}`);
    // यहां Firestore query और UI अपडेट का लॉजिक आएगा
    // For now, it just reloads the home page (or a search result page)
    showPage('homePage'); 
}

// =============================================================
// 8. Initialization (एप्लिकेशन शुरू करना)
// =============================================================

/**
 * एप्लिकेशन को शुरू करने के लिए मुख्य फ़ंक्शन
 */
export function initMetubeApp(appId, auth, db, storage) {
    METUBE_APP_ID = appId;
    AUTH_SERVICE = auth;
    DB_SERVICE = db;
    STORAGE_SERVICE = storage;

    // 1. ऑथेंटिकेशन लिसनर सेट करें (यह currentUser सेट करेगा और loadVideos को कॉल करेगा)
    setupAuthListener();

    // 2. अपलोड इवेंट लिसनर सेट करें (इन्हें पहले लगाना ज़रूरी है)
    
    // फ़ाइल इनपुट बटन क्लिक
    document.getElementById('selectFileBtn').addEventListener('click', () => {
        fileInput.click();
    });

    // फ़ाइल चुनने पर (जब फ़ाइल इनपुट बदलता है)
    fileInput.addEventListener('change', handleFileInputChange);

    // फ़ॉर्म सबमिट करने पर
    if (uploadForm) {
        uploadForm.addEventListener('submit', uploadVideo);
    }

    // Drag and Drop लॉजिक
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', () => { uploadArea.classList.remove('drag-over'); });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            fileInput.files = e.dataTransfer.files; // ड्रॉप की गई फ़ाइल को इनपुट में सेट करें
            handleFileInputChange({ target: fileInput }); // चेंज हैंडलर को ट्रिगर करें
        });
    }

    // 3. प्ले वीडियो को ग्लोबल करें ताकि यह कार्ड क्लिक पर काम करे
    window.playVideo = playVideo;
}

