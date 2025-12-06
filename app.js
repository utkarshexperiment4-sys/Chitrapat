// app.js - Metube एप्लिकेशन का मुख्य लॉजिक (Cloudinary XHR Upload और लाइव प्रगति के साथ)

// =============================================================
// 0. 🔥 आवश्यक Firebase Imports 
// =============================================================

import { 
    collection, 
    query, 
    onSnapshot, 
    addDoc, 
    doc, 
    updateDoc, 
    increment,
    enableIndexedDbPersistence // ✅ नया इम्पोर्ट: Firestore को ऑफ़लाइन क्षमता देने के लिए
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// =============================================================
// 1. ग्लोबल वैरिएबल्स और स्टेट
// =============================================================

let METUBE_APP_ID;
let AUTH_SERVICE;
let DB_SERVICE;
let currentUser = null; 
let currentFile = null;

const VIDEOS_COLLECTION = 'videos';

// ✅ Cloudinary Configuration
// Cloud Name का उपयोग अनसाइंड अपलोड के लिए किया जाता है।
const CLOUDINARY_CLOUD_NAME = 'dw1ksfmm7';
// Cloudinary में बनाए गए Unsigned Preset का नाम: (यदि आपने नाम बदला हो तो यहाँ भी बदलें)
const CLOUDINARY_UPLOAD_PRESET = 'metube_final_video'; 


// UI Elements
const videosGrid = document.getElementById('videosGrid');
const loadingVideos = document.querySelector('.loading-videos');

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

function formatNumber(num) {
    if (num >= 1000000) { return (num / 1000000).toFixed(1) + 'M'; }
    if (num >= 1000) { return (num / 1000).toFixed(0) + 'K'; }
    return num;
}

// =============================================================
// 3. UI/नेविगेशन फ़ंक्शंस
// =============================================================

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('active');
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.style.display = 'none';
        page.classList.remove('active');
    });

    const activePage = document.getElementById(pageId);
    if (activePage) {
        activePage.style.display = 'block';
        activePage.classList.add('active');
    }
    
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (pageId === 'homePage') {
        document.querySelector('.bottom-nav .nav-item:first-child').classList.add('active');
    }
}

// =============================================================
// 4. Firebase Auth
// =============================================================

function setupAuthListener(auth) {
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            console.log("User is signed in:", currentUser.uid);
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('loggedUser').style.display = 'flex';
            document.getElementById('userAvatar').src = `https://placehold.co/36x36/888/fff?text=${user.email?.charAt(0).toUpperCase() || 'U'}`;
        } else {
            currentUser = null;
            console.log("User is signed out.");
            document.getElementById('loginBtn').style.display = 'flex';
            document.getElementById('loggedUser').style.display = 'none';
            
            document.getElementById('loginBtn').onclick = async () => {
                try {
                    await auth.signInAnonymously();
                } catch (error) {
                    console.error("Anonymous login failed:", error);
                }
            };
        }
    });
}

// =============================================================
// 5. Firestore Data Handling
// =============================================================

function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => playVideo(video.id, video);
    
    const uploadDate = video.timestamp?.toDate ? video.timestamp.toDate() : new Date(video.timestamp || Date.now());
    
    card.innerHTML = `
        <div class="thumbnail-container">
            <img src="${video.thumbnailUrl || 'https://placehold.co/480x270/0f0f0f/fff?text=Metube'}" alt="${video.title}" class="thumbnail">
            <span class="video-duration">${video.duration || '10:45'}</span>
        </div>
        <div class="video-details">
            <img src="https://placehold.co/36x36/ff0000/fff?text=C" alt="चैनल" class="channel-avatar">
            <div class="details-text">
                <h3 class="video-title-card">${video.title}</h3>
                <p class="channel-name">${video.userName || `User: ${video.userId?.substring(0, 8)}...`}</p>
                <p class="video-stats">${formatNumber(video.views || 0)} दृश्य • ${formatTimeSince(uploadDate)}</p>
            </div>
        </div>
    `;
    return card;
}

function loadVideos(db, appId) {
    if (!db || !appId) {
        console.error("Firestore not initialized");
        return;
    }

    videosGrid.innerHTML = '';
    if (loadingVideos) loadingVideos.style.display = 'block';

    try {
        const videosRef = collection(db, 'artifacts', appId, 'public', 'data', VIDEOS_COLLECTION);
        const q = query(videosRef);
        
        onSnapshot(q, (snapshot) => {
            const videoList = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                videoList.push({ 
                    id: doc.id, 
                    views: data.views || 0,
                    title: data.title || 'Untitled',
                    description: data.description || '',
                    url: data.url || '',
                    thumbnailUrl: data.thumbnailUrl || '',
                    userId: data.userId || 'anonymous',
                    timestamp: data.timestamp || new Date(),
                    ...data 
                });
            });

            videoList.sort((a, b) => {
                const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
                const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
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
            if (loadingVideos) loadingVideos.style.display = 'none';
        }, (error) => {
            console.error("Firestore onSnapshot failed:", error);
            // ⚠️ ऑफ़लाइन होने पर, यह त्रुटि आ सकती है, लेकिन डेटा कैश से लोड होना चाहिए
            if (loadingVideos) loadingVideos.textContent = 'वीडियो लोड करने में त्रुटि आई। (शायद ऑफ़लाइन)';
        });
    } catch (error) {
        console.error("Error setting up Firestore listener:", error);
    }
}

// =============================================================
// 6. VIDEO UPLOAD लॉजिक (XHR के साथ लाइव प्रगति दिखाने के लिए बदला गया)
// =============================================================

/**
 * क्लाइंट-साइड पर Cloudinary Unsigned Upload करता है और प्रगति अपडेट करता है।
 * @param {File} file अपलोड करने के लिए फ़ाइल
 * @returns {Promise<string>} डाउनलोड URL
 */
async function uploadVideoToCloudinary(file) {
    return new Promise((resolve, reject) => {
        const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); 

        const xhr = new XMLHttpRequest();
        const startTime = Date.now();

        // 1. प्रगति हैंडलर: अपलोड होते समय बार-बार UI को अपडेट करता है
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded * 100) / e.total);
                
                // अपलोड प्रगति को 0% से 70% तक दिखाएँ (बाकी 30% Firestore के लिए)
                progressFill.style.width = `${percent * 0.7}%`;
                progressText.textContent = `अपलोड हो रहा है: ${percent}%`;
                
                // अपलोड स्पीड का अनुमान दिखाएँ
                const uploadTime = (Date.now() - startTime) / 1000;
                const speed = (e.loaded / 1024 / uploadTime).toFixed(1);
                uploadSpeed.textContent = `गति: ${speed} KB/s`;
            }
        });

        // 2. त्रुटि हैंडलर
        xhr.addEventListener('error', () => {
            reject(new Error("नेटवर्क त्रुटि या टाइमआउट के कारण अपलोड विफल।"));
        });
        
        // 3. पूर्णता हैंडलर
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                resolve(data.secure_url);
            } else {
                let errorMessage = xhr.statusText;
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    errorMessage = errorData.error ? errorData.error.message : xhr.statusText;
                } catch (e) { /* ignore */ }
                
                reject(new Error(`Cloudinary अपलोड विफल: ${xhr.status} - ${errorMessage}`));
            }
        });
        
        // 4. अनुरोध भेजें
        xhr.open('POST', url);
        xhr.send(formData);
        
        // UI को अपलोड शुरू होने का संकेत दें
        progressFill.style.width = '5%';
        progressText.textContent = 'अपलोड शुरू हो रहा है...';

    });
}


function handleFileInputChange(e) {
    const file = e.target.files[0];
    if (file) {
        currentFile = file;
        fileNameDisplay.textContent = `चुनी गई फ़ाइल: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        uploadDetails.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'प्रगति: फ़ाइल तैयार है';
        uploadSpeed.textContent = '';
    } else {
        currentFile = null;
        fileNameDisplay.textContent = 'कोई फ़ाइल नहीं चुनी गई।';
        uploadDetails.style.display = 'none';
    }
}


async function uploadVideo(e, db, storage, appId) { 
    e.preventDefault();
    
    if (!currentFile) {
        alert('कृपया अपलोड करने के लिए एक वीडियो फ़ाइल चुनें!');
        return;
    }
    // Cloudinary प्रीसेट चेक अब अनावश्यक है क्योंकि हमने इसे 'metube_live' में सेट कर दिया है।
    
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;
    
    const userId = currentUser ? currentUser.uid : 'anonymous';
    const userName = currentUser?.email || 'Anonymous User';
    
    let downloadURL = null;

    // ----------------------------------------------------
    // 1. Cloudinary पर असली अपलोड शुरू करें
    // ----------------------------------------------------
    try {
        progressText.textContent = 'Cloudinary पर अपलोड हो रहा है...';
        // progressFill.style.width = '10%'; <--- XHR प्रगति को अपडेट करेगा
        uploadSpeed.textContent = 'नेटवर्क अनुरोध शुरू...';

        // ⚠️ यहाँ असली XHR अपलोड लॉजिक है!
        downloadURL = await uploadVideoToCloudinary(currentFile); 
        
        progressText.textContent = 'अपलोड पूरा!';
        progressFill.style.width = '70%'; // अपलोड पूरा होने पर 70% दिखाएँ
        uploadSpeed.textContent = 'URL प्राप्त: ' + downloadURL.substring(0, 30) + '...';

    } catch (uploadError) {
        console.error("Cloudinary Upload failed:", uploadError);
        progressText.textContent = 'अपलोड विफल: ' + uploadError.message;
        progressFill.style.width = '0%';
        uploadSpeed.textContent = '';
        return; 
    }

    // ----------------------------------------------------
    // 2. Firestore में metadata सहेजें
    // ----------------------------------------------------
    try {
        progressText.textContent = 'डेटाबेस में मेटाडेटा सहेजा जा रहा है...';
        progressFill.style.width = '90%';
        
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', VIDEOS_COLLECTION), {
            userId: userId,
            userName: userName,
            title: title,
            description: description,
            category: category,
            url: downloadURL, // ✅ Cloudinary से प्राप्त असली URL
            thumbnailUrl: downloadURL.replace('/upload/', '/upload/w_480,h_270,c_fill,g_auto/'), // Cloudinary Thumbnail URL बनाना आसान है
            views: 0,
            likes: 0,
            timestamp: new Date()
        });

        console.log('वीडियो सफलतापूर्वक अपलोड और प्रकाशित हो गया!');
        
        // UI रीसेट करें
        uploadForm.reset();
        currentFile = null;
        progressFill.style.width = '100%';
        progressText.textContent = 'अपलोड और सेव सफल!';
        uploadSpeed.textContent = '';
        
        fileNameDisplay.textContent = 'कोई फ़ाइल नहीं चुनी गई।';
        uploadDetails.style.display = 'none';

        setTimeout(() => {
            showPage('homePage');
            loadVideos(db, appId);
        }, 2000);
        
    } catch (firestoreError) {
        console.error("Failed to save metadata to Firestore:", firestoreError);
        progressText.textContent = 'अपलोड सफल, पर डेटाबेस त्रुटि: ' + firestoreError.message;
        progressFill.style.width = '70%';
    }
}


// =============================================================
// 7. VIDEO PLAYER लॉजिक
// =============================================================

async function playVideo(videoId, videoData) {
    if (!DB_SERVICE || !METUBE_APP_ID) return;

    try {
        const videoDocRef = doc(DB_SERVICE, 'artifacts', METUBE_APP_ID, 'public', 'data', VIDEOS_COLLECTION, videoId);
        await updateDoc(videoDocRef, {
            views: increment(1)
        });
        videoData.views = (videoData.views || 0) + 1;
    } catch (e) {
        console.error("Error updating view count:", e);
    }
    
    mainVideoPlayer.src = videoData.url;
    playerVideoTitle.textContent = videoData.title;
    playerVideoDescription.textContent = videoData.description;
    
    const uploadDate = videoData.timestamp?.toDate ? videoData.toDate() : new Date(videoData.timestamp);
    playerVideoStats.textContent = `${formatNumber(videoData.views || 0)} दृश्य • ${formatTimeSince(uploadDate)}`;
    playerChannelName.textContent = videoData.userName || `User: ${videoData.userId?.substring(0, 10)}...`;

    showPage('playerPage');
    
    setTimeout(() => {
        mainVideoPlayer.play().catch(e => console.log("Auto-play blocked:", e));
    }, 500);
}

function searchVideos() {
    const query = document.getElementById('searchInput').value;
    console.log(`Searching for: ${query}`);
    showPage('homePage');
}

// =============================================================
// 8. Initialization (PWA और Offline Persistence)
// =============================================================

function initMetubeApp(appId, auth, db, storage) { 
    METUBE_APP_ID = appId;
    AUTH_SERVICE = auth;
    DB_SERVICE = db;

    // ----------------------------------------------------
    // ✅ 1. PWA सर्विस वर्कर रजिस्ट्रेशन (ऑफ़लाइन क्षमता के लिए)
    // ----------------------------------------------------
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js') // आपके sw.js फ़ाइल का नाम सही है
        .then(() => {
            console.log('PWA: Service Worker registered successfully!');
        })
        .catch(error => {
            console.error('PWA: Service Worker registration failed:', error);
        });
    }

    // ----------------------------------------------------
    // ✅ 2. Firestore ऑफ़लाइन परसिस्टेंस (ऑफ़लाइन वीडियो कार्ड के लिए)
    // ----------------------------------------------------
    enableIndexedDbPersistence(db)
      .then(() => {
        console.log("Firestore offline persistence enabled.");
      })
      .catch((err) => {
        if (err.code === 'failed-precondition') {
          console.warn("Persistence failed: Multiple tabs open.");
        } else if (err.code === 'unimplemented') {
          console.warn("Persistence failed: Browser does not support.");
        }
      });
      
    setupAuthListener(auth);
    loadVideos(db, appId);
    
    document.getElementById('selectFileBtn').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileInputChange);

    if (uploadForm) {
        uploadForm.addEventListener('submit', (e) => uploadVideo(e, db, null, appId));
    }

    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                handleFileInputChange({ target: fileInput });
            }
        });
    }

    window.playVideo = playVideo;
    window.showPage = showPage;
    window.toggleSidebar = toggleSidebar;
    window.searchVideos = searchVideos;
}

export { initMetubeApp, showPage, toggleSidebar, searchVideos };
