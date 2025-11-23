#(function () {
    'use strict';
    // CyTube BattleTanks — Deterministic /startgame
    // Load Three.js dynamically
    function loadThree(version = '0.158.0') {
        return new Promise((resolve, reject) => {
            if (window.THREE) return resolve(window.THREE);
            const s = document.createElement('script');
            s.src = `https://cdn.jsdelivr.net/npm/three@${version}/build/three.min.js`;
            s.onload = () => resolve(window.THREE);
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    async function sha256Hex(str) {
        const enc = new TextEncoder();
        const data = enc.encode(str);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    function hexToSeedInt(hex) {
        return parseInt(hex.slice(0, 8), 16) >>> 0;
    }
    // Mulberry32 PRNG
    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    // Time sync for deterministic collisions
    let timeOffset = 0;
    async function syncTime() {
        try {
            const start = Date.now() / 1000;
            const res = await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store' });
            const end = Date.now() / 1000;
            const serverDate = new Date(res.headers.get('Date')).getTime() / 1000;
            const rtt = end - start;
            timeOffset = (serverDate + rtt / 2) - end;
            console.log(`Time offset: ${timeOffset.toFixed(3)}s`);
        } catch (e) {
            console.error('Time sync failed:', e);
        }
    }
    function getSyncedTime() {
        return Date.now() / 1000 + timeOffset;
    }
    async function main() {
        await syncTime(); // Re-added for deterministic long sims
        await loadThree().catch(err => console.error("Failed to load Three.js", err));
        // Canvas + renderer
        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.zIndex = '-1';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        renderer.shadowMap.enabled = true;
        renderer.setSize(window.innerWidth, window.innerHeight);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        camera.position.set(0, 20, 40);
        camera.lookAt(0, 0, 0);
        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        });
        // Expose for console debug
        window.renderer = renderer;
        window.scene = scene;
        window.camera = camera;
        // Terrain
        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const terrainMat = new THREE.MeshBasicMaterial({ color: 0x00aa88, wireframe: true });
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));
        // Textures
        const loader = new THREE.TextureLoader();
        const userTex = loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp');
        const foeTex = loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp');
        const foodTex = loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp');
        const userMat = new THREE.MeshBasicMaterial({ map: userTex, transparent: true });
        const foeMat = new THREE.MeshBasicMaterial({ map: foeTex, transparent: true });
        const foodMat = new THREE.MeshBasicMaterial({ map: foodTex, transparent: true });
        const entityGeo = new THREE.BoxGeometry(2, 3, 2);
        const entities = [];
        const knownUsers = new Map();
        // Expose for console debug
        window.entities = entities;
        let currentGlobalSeedHex = null;
        let globalPRNG = null;
        function clearEntities() {
            while (entities.length) {
                const e = entities.pop();
                try { scene.remove(e.mesh); } catch (err) {}
            }
            knownUsers.clear();
            console.log(`[${new Date().toLocaleTimeString()}] cleared entities`);
        }
        // --- Debounce guard ---
        let startgameCooldown = false;
        function roomNameFromPath() {
            const parts = (window.location.pathname || '').split('/');
            return parts[parts.length - 1] || 'room';
        }
        // Username extraction from DOM
        function getSanitizedUsernames() {
            const usernames = [];
            const rows = document.querySelectorAll('#userlist .userlist_item');
            if (rows && rows.length) {
                for (const row of rows) {
                    const nameSpan = row.querySelector('span:nth-of-type(2)');
                    if (nameSpan && nameSpan.textContent.trim()) {
                        usernames.push(nameSpan.textContent.trim());
                    }
                }
            }
            const cleaned = Array.from(new Set(usernames.filter(Boolean).map(s => s.trim())));
            cleaned.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            return cleaned;
        }
        async function spawnDeterministic(seedWord) {
            if (startgameCooldown) {
                console.warn("Ignored duplicate /startgame during debounce window.");
                return;
            }
            startgameCooldown = true;
            setTimeout(() => (startgameCooldown = false), 500);
            const room = roomNameFromPath();
            const combined = `${room}:${seedWord}`;
            currentGlobalSeedHex = await sha256Hex(combined);
            const seedInt = hexToSeedInt(currentGlobalSeedHex);
            globalPRNG = mulberry32(seedInt);
            clearEntities();
            const usernames = getSanitizedUsernames();
            const playerCount = Math.max(1, usernames.length);
            const foeCount = Math.max(4, Math.floor(playerCount * 1.0));
            const foodCount = Math.max(4, Math.floor(playerCount * 0.8));
            console.log(
                `[${new Date().toLocaleTimeString()}] /startgame seed="${seedWord}" room="${room}" players=${playerCount} foes=${foeCount} food=${foodCount}`
            );
            // --- Spawn users ---
            for (let i = 0; i < playerCount; i++) {
                const uname = usernames[i % usernames.length] || `player${i}`;
                const perUserSeedHex = await sha256Hex(currentGlobalSeedHex + '::user::' + uname);
                const perUserSeedInt = hexToSeedInt(perUserSeedHex);
                const userPRNG = mulberry32(perUserSeedInt);
                const ux = (userPRNG() - 0.5) * 80;
                const uz = (userPRNG() - 0.5) * 80;
                let uvx = (userPRNG() - 0.5) * 0.7 * 80;
                let uvz = (userPRNG() - 0.5) * 0.7 * 80;
                const mesh = new THREE.Mesh(entityGeo, userMat);
                mesh.position.set(ux, 1, uz);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                const ent = { mesh, type: 'user', id: uname, velocity: new THREE.Vector3(uvx, 0, uvz), health: 3 };
                scene.add(mesh);
                entities.push(ent);
                knownUsers.set(uname, ent);
            }
            // --- Spawn foes ---
            for (let i = 0; i < foeCount; i++) {
                const foeSeedHex = await sha256Hex(currentGlobalSeedHex + `::foe::${i}`);
                const foeSeedInt = hexToSeedInt(foeSeedHex);
                const pr = mulberry32(foeSeedInt);
                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                let vx = (pr() - 0.5) * 0.7 * 80;
                let vz = (pr() - 0.5) * 0.7 * 80;
                const mesh = new THREE.Mesh(entityGeo, foeMat);
                mesh.position.set(x, 1, z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                entities.push({ mesh, type: 'foe', id: `foe${i}`, velocity: new THREE.Vector3(vx, 0, vz) });
                scene.add(mesh);
            }
            // --- Spawn food ---
            for (let i = 0; i < foodCount; i++) {
                const foodSeedHex = await sha256Hex(currentGlobalSeedHex + `::food::${i}`);
                const foodSeedInt = hexToSeedInt(foodSeedHex);
                const pr = mulberry32(foodSeedInt);
                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                let vx = (pr() - 0.5) * 0.4 * 80;
                let vz = (pr() - 0.5) * 0.4 * 80;
                const mesh = new THREE.Mesh(entityGeo, foodMat);
                mesh.position.set(x, 1, z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                entities.push({ mesh, type: 'food', id: `food${i}`, velocity: new THREE.Vector3(vx, 0, vz) });
                scene.add(mesh);
            }
            console.log(`[${new Date().toLocaleTimeString()}] spawn complete - total entities: ${entities.length}`);
            for (const e of entities) {
                console.log(` ${e.type} ${e.id}: (${e.mesh.position.x.toFixed(2)}, ${e.mesh.position.z.toFixed(2)})`);
            }
        }
        // --- Animation (with time sync for deterministic collisions) ---
        const TIME_STEP = 0.016; // Fixed step ~60FPS
        let lastTime = getSyncedTime();
        function animate() {
            requestAnimationFrame(animate);
            const now = getSyncedTime();
            let delta = now - lastTime;
            while (delta >= TIME_STEP) {
                updateSimulation(TIME_STEP);
                delta -= TIME_STEP;
            }
            lastTime = now - delta;
            renderer.render(scene, camera);
        }
        function updateSimulation(dt) {
            // console.log('dt: ' + dt.toFixed(4)); // Comment out after test
            for (const e of entities) {
                e.mesh.position.add(e.velocity.clone().multiplyScalar(dt));
                e.mesh.rotation.y += 0.01;
                if (e.type === 'user' && e.health !== undefined) {
                    e.mesh.material.color.setHSL((e.health / 3) * 0.3, 0.8, 0.5);
                }
            }
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const A = entities[i], B = entities[j];
                    const boxA = new THREE.Box3().setFromObject(A.mesh);
                    const boxB = new THREE.Box3().setFromObject(B.mesh);
                    if (!boxA.intersectsBox(boxB)) continue;
                    const tmp = A.velocity.clone();
                    A.velocity.copy(B.velocity);
                    B.velocity.copy(tmp);
                    if (A.type === 'user' && B.type === 'foe') { A.health -= 2; scene.remove(B.mesh); entities.splice(j, 1); j--; continue; }
                    if (A.type === 'foe' && B.type === 'user') { B.health -= 2; scene.remove(A.mesh); entities.splice(i, 1); i--; break; }
                    if (A.type === 'user' && B.type === 'food') { A.health += 1; scene.remove(B.mesh); entities.splice(j, 1); j--; continue; }
                    if (A.type === 'food' && B.type === 'user') { B.health += 1; scene.remove(A.mesh); entities.splice(i, 1); i--; break; }
                    if (A.type === 'user' && B.type === 'user') { A.health -= 1; B.health -= 1; }
                }
            }
            for (const e of entities) {
                if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
            }
            for (let i = entities.length - 1; i >= 0; i--) {
                const e = entities[i];
                if (e.type === 'user' && e.health <= 0) { knownUsers.delete(e.id); scene.remove(e.mesh); entities.splice(i, 1); }
            }
        }
        animate();
        // --- Chat command detection ---
        const startRegex = /^\/startgame\s+(.+)$/i;
        function processCommandText(text, username) {
            if (!text) return;
            const m = text.trim().match(startRegex);
            if (!m) return;
            const seed = m[1].trim();
            // Optional mod check (uncomment if needed)
            // if (!isMod(username)) return;
            console.log(`[${new Date().toLocaleTimeString()}] Detected /startgame "${seed}" from ${username || 'unknown'}`);
            spawnDeterministic(seed);
        }
        // Function to check mod (from class)
        function isMod(username) {
            const userItem = Array.from(document.querySelectorAll('#userlist .userlist_item')).find(item => 
                item.querySelector('span:nth-of-type(2)')?.textContent.trim() === username
            );
            const rankSpan = userItem ? userItem.querySelector('span:nth-of-type(2)') : null;
            return rankSpan && (rankSpan.classList.contains('userlist_owner') || rankSpan.classList.contains('userlist_mod') || rankSpan.classList.contains('userlist_admin'));
        }
        // Socket detection
        try {
            if (window.socket && typeof window.socket.on === "function") {
                window.socket.on('chatMsg', data => {
                    if (data && typeof data.msg === 'string') {
                        processCommandText(data.msg, data.username);
                    }
                });
                console.log('Socket chat listener added');
            }
        } catch (e) {
            console.warn('Socket not accessible:', e);
        }
        // Mutation fallback
        const bodyObs = new MutationObserver(muts => {
            for (const mut of muts) {
                for (const node of mut.addedNodes) {
                    if (node.nodeType !== 1 || !node.classList.toString().startsWith('chat-msg-')) continue;
                    const usernameEl = node.querySelector('.username');
                    const username = usernameEl ? usernameEl.textContent.trim().replace(':', '') : 'unknown';
                    const msgSpan = node.querySelector('span:last-child');
                    const text = msgSpan ? msgSpan.textContent.trim() : '';
                    processCommandText(text, username);
                }
            }
        });
        bodyObs.observe(document.getElementById('messagebuffer') || document.body, { childList: true, subtree: true });
        window.CBT_start = seed => {
            if (!seed) return console.warn('Usage: CBT_start("seed")');
            processCommandText(`/startgame ${seed}`, 'console');
        };
        console.log(`[${new Date().toLocaleTimeString()}] CyTube BattleTanks loaded. Type "/startgame <seed>" in chat.`);
    }
    main().catch(err => console.error("BattleTanks init error", err));
})();