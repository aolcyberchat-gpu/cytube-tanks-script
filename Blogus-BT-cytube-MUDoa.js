// ==UserScript==
// @name         CyTube BattleTanks — Deterministic /startgame with collisions
// @namespace    http://www.cytu.be
// @version      1.0.13
// @description  Deterministic tanks/foes/food using /startgame <seed> on cytu.be rooms, with collisions and wall bounces
// @author       Guy McFurry III (adapted)
// @match        https://cytu.be/r/BLOGUS
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // --- Load Three.js dynamically ---
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

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    async function main() {
        await loadThree().catch(err => console.error("Failed to load Three.js", err));

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

        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const loader = new THREE.TextureLoader();
        const terrainTex = loader.load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif');
        const terrainMat = new THREE.MeshBasicMaterial({ map: terrainTex, wireframe: false });
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

        const userTex = loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp');
        const foeTex = loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp');
        const foodTex = loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp');
        const ghostTex = loader.load('https://i.ibb.co/CKMC9K3v/ghost-user.gif');

        const userMatGreen = new THREE.MeshBasicMaterial({ map: userTex, color: 0x00ff00 });
        const userMatYellow = new THREE.MeshBasicMaterial({ map: userTex, color: 0xffff00 });
        const userMatRed = new THREE.MeshBasicMaterial({ map: userTex, color: 0xff0000 });
        const foeMat = new THREE.MeshBasicMaterial({ map: foeTex });
        const foodMat = new THREE.MeshBasicMaterial({ map: foodTex });
        const ghostMat = new THREE.MeshBasicMaterial({ map: ghostTex });
        const entityGeo = new THREE.BoxGeometry(2, 3, 2);

        const entities = [];
        const knownUsers = new Map();
        let currentGlobalSeedHex = null;
        let globalPRNG = null;

        function clearEntities() {
            while (entities.length) {
                const e = entities.pop();
                try { 
                    scene.remove(e.mesh); 
                    if (e.label) scene.remove(e.label);
                } catch (err) {}
            }
            knownUsers.clear();
        }

        let startgameCooldown = false;
        function roomNameFromPath() {
            const parts = (window.location.pathname || '').split('/');
            return parts[parts.length - 1] || 'room';
        }

        function getSanitizedUsernames() {
            const usernames = [];
            const rows = document.querySelectorAll('#userlist .userlist_item');
            for (const row of rows) {
                const span2 = row.querySelector('span:nth-of-type(2)');
                if (span2 && span2.textContent) usernames.push(span2.textContent.trim());
            }
            return Array.from(new Set(usernames.filter(Boolean))).sort();
        }

        function createTextLabel(text) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            context.font = 'Bold 20px Arial';
            const textWidth = context.measureText(text).width;
            canvas.width = textWidth + 10;
            canvas.height = 30;
            context.fillStyle = 'rgba(0, 0, 0, 0.5)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = 'white';
            context.font = 'Bold 20px Arial';
            context.fillText(text, 5, 20);
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            const material = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(canvas.width / 10, canvas.height / 10, 1);
            return sprite;
        }

        async function spawnDeterministic(seedWord) {
            if (startgameCooldown) return;
            startgameCooldown = true;
            setTimeout(() => (startgameCooldown = false), 500);

            const room = roomNameFromPath();
            const combined = `(${room}:){seedWord}`;
            currentGlobalSeedHex = await sha256Hex(combined);
            const seedInt = hexToSeedInt(currentGlobalSeedHex);
            globalPRNG = mulberry32(seedInt);

            clearEntities();
            const usernames = getSanitizedUsernames();
            const playerCount = Math.max(1, usernames.length);
            const foeCount = Math.max(4, Math.floor(playerCount * 1.0));
            const foodCount = Math.max(4, Math.floor(playerCount * 0.8));

            // --- Spawn users ---
            for (let i = 0; i < playerCount; i++) {
                const uname = usernames[i % usernames.length] || `player${i}`;
                const perUserSeedHex = await sha256Hex(currentGlobalSeedHex + '::user::' + uname);
                const perUserSeedInt = hexToSeedInt(perUserSeedHex);
                const userPRNG = mulberry32(perUserSeedInt);

                const ux = (userPRNG() - 0.5) * 80;
                const uz = (userPRNG() - 0.5) * 80;
                const uvx = (userPRNG() - 0.5) * 0.7;
                const uvz = (userPRNG() - 0.5) * 0.7;

                const mesh = new THREE.Mesh(entityGeo, userMatGreen);
                mesh.position.set(ux, 1, uz);

                const label = createTextLabel(uname);
                label.position.set(0, 4, 0);
                mesh.add(label);

                const ent = { 
                    mesh, 
                    label, 
                    type: 'user', 
                    id: uname, 
                    velocity: new THREE.Vector3(uvx, 0, uvz), 
                    health: 3 
                };
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
                const vx = (pr() - 0.5) * 0.7;
                const vz = (pr() - 0.5) * 0.7;

                const mesh = new THREE.Mesh(entityGeo, foeMat);
                mesh.position.set(x, 1, z);
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
                const vx = (pr() - 0.5) * 0.4;
                const vz = (pr() - 0.5) * 0.4;

                const mesh = new THREE.Mesh(entityGeo, foodMat);
                mesh.position.set(x, 1, z);
                entities.push({ mesh, type: 'food', id: `food${i}`, velocity: new THREE.Vector3(vx, 0, vz) });
                scene.add(mesh);
            }
        }

        function animate() {
            requestAnimationFrame(animate);

            for (const e of entities) {
                e.mesh.position.add(e.velocity);

                // Update user health color
                if (e.type === 'user') {
                    if (e.health >= 3) e.mesh.material = userMatGreen;
                    else if (e.health === 2) e.mesh.material = userMatYellow;
                    else if (e.health === 1) e.mesh.material = userMatRed;
                }
            }

            // --- Pairwise collisions ---
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const A = entities[i], B = entities[j];
                    if (A.type === 'ghost' || B.type === 'ghost') continue;

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

            // --- Terrain bounce ---
            for (const e of entities) {
                if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
            }

            // --- Ghost conversion ---
            for (let i = entities.length - 1; i >= 0; i--) {
                const e = entities[i];
                if (e.type === 'user' && e.health <= 0) { 
                    e.type = 'ghost';
                    e.mesh.material = ghostMat;
                    e.health = 0;
                    knownUsers.delete(e.id); 
                }
            }

            renderer.render(scene, camera);
        }
        animate();

        const startRegex = /^\/startgame\s+(.+)$/i;
        function processCommandText(text) {
            if (!text) return;
            const m = text.trim().match(startRegex);
            if (!m) return;
            const seed = m[1].trim();
            spawnDeterministic(seed);
        }

        if (window.socket && typeof window.socket.on === "function") {
            const tryNames = ['chatMsg', 'chat message', 'chat message new', 'chat'];
            for (const ev of tryNames) {
                try {
                    window.socket.on(ev, data => {
                        try {
                            if (data && typeof data === 'object') {
                                if (typeof data.msg === 'string') processCommandText(data.msg);
                                else if (typeof data.message === 'string') processCommandText(data.message);
                            } else if (typeof data === 'string') processCommandText(data);
                        } catch (e) {}
                    });
                } catch (e) {}
            }
        }

        const bodyObs = new MutationObserver(muts => {
            for (const mut of muts) {
                for (const node of mut.addedNodes) {
                    if (!node) continue;
                    try {
                        if (node.nodeType === Node.TEXT_NODE) processCommandText(node.textContent);
                        else if (node.nodeType === Node.ELEMENT_NODE) {
                            const txt = (node.textContent || node.innerText || '').trim();
                            if (startRegex.test(txt)) processCommandText(txt);
                        }
                    } catch (e) {}
                }
            }
        });
        bodyObs.observe(document.body, { childList: true, subtree: true });

        window.CBT_start = seed => { if (!seed) return console.warn('Usage: CBT_start("seed")'); processCommandText(`/startgame ${seed}`); };
    }

    main().catch(err => console.error("BattleTanks init error", err));
})();
