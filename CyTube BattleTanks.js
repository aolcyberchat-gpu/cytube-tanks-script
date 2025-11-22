// ==UserScript==
// @name         CyTube BattleTanks — Deterministic /startgame
// @namespace    http://www.cytu.be
// @version      1.0.10
// @description  Deterministic tanks/foes/food using /startgame <seed> on cytu.be rooms. Spawns based on room + seed + usernames so all clients see the same world.
// @author       Guy McFurry III (adapted)
// @match        https://cytu.be/r/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // --------------------
    // Utility & libs
    // --------------------
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
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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

    // --------------------
    // Deterministic time sync (optional)
    // --------------------
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
            console.warn('Time sync failed:', e);
        }
    }
    function getSyncedTime() {
        return Date.now() / 1000 + timeOffset;
    }

    // --------------------
    // Label helper (canvas → sprite)
    // --------------------
    function createNameLabel(text) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");

        // background
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        roundRect(ctx, 0, 0, canvas.width, canvas.height, 8);
        ctx.fill();

        // text
        ctx.font = "28px Arial";
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(12, 3, 1);
        sprite.center.set(0.5, 0);

        return sprite;

        // small helper to draw rounded rect
        function roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }
    }

    // --------------------
    // Main
    // --------------------
    async function main() {
        await syncTime();
        await loadThree().catch(err => console.error("Failed to load Three.js", err));

        // Canvas / renderer
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
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 20, 40);
        camera.lookAt(0, 0, 0);

        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        });

        // expose for debugging
        window.renderer = renderer;
        window.scene = scene;
        window.camera = camera;

        // terrain
        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const terrainMat = new THREE.MeshBasicMaterial({ color: 0x00aa88, wireframe: true });
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

        // textures
        const loader = new THREE.TextureLoader();
        const userTex = loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp');
        const foeTex = loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp');
        const foodTex = loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp');

        const entityGeo = new THREE.BoxGeometry(2, 3, 2);

        // state
        const entities = []; // { mesh, type, id, velocity:Vector3, health, hue }
        const knownUsers = new Map();
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

        // debounce guard
        let startgameCooldown = false;

        function roomNameFromPath() {
            const parts = (window.location.pathname || '').split('/');
            return parts[parts.length - 1] || 'room';
        }

        // sanitized usernames (your concrete HTML uses second span)
        function getSanitizedUsernames() {
            const rows = document.querySelectorAll('#userlist .userlist_item');
            const names = [];
            for (const row of rows) {
                const span = row.querySelector('span:nth-of-type(2)');
                if (span && span.textContent && span.textContent.trim()) names.push(span.textContent.trim());
            }
            const clean = Array.from(new Set(names));
            clean.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            return clean;
        }

        // spawn deterministic
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

            console.log(`[${new Date().toLocaleTimeString()}] /startgame seed="${seedWord}" room="${room}" players=${playerCount} foes=${foeCount} food=${foodCount}`);

            // spawn users
            for (let i = 0; i < playerCount; i++) {
                const uname = usernames[i % usernames.length] || `player${i}`;
                const perUserSeedHex = await sha256Hex(currentGlobalSeedHex + '::user::' + uname);
                const perUserSeedInt = hexToSeedInt(perUserSeedHex);
                const userPRNG = mulberry32(perUserSeedInt);

                const ux = (userPRNG() - 0.5) * 80;
                const uz = (userPRNG() - 0.5) * 80;
                const uvx = (userPRNG() - 0.5) * 0.7 * 80;
                const uvz = (userPRNG() - 0.5) * 0.7 * 80;

                const hue = userPRNG(); // 0..1
                const mat = new THREE.MeshBasicMaterial({
                    map: userTex,
                    transparent: true,
                    color: new THREE.Color().setHSL(hue, 0.8, 0.5)
                });
                // store hue in material.userData for future health-based lightness changes
                mat.userData = { hue };

                const mesh = new THREE.Mesh(entityGeo, mat);
                mesh.position.set(ux, 1, uz);
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                // label
                const label = createNameLabel(uname);
                label.position.set(0, 4, 0);
                mesh.add(label);

                const ent = {
                    mesh,
                    type: 'user',
                    id: uname,
                    velocity: new THREE.Vector3(uvx, 0, uvz),
                    health: 3,
                    hue
                };

                scene.add(mesh);
                entities.push(ent);
                knownUsers.set(uname, ent);
            }

            // spawn foes
            for (let i = 0; i < foeCount; i++) {
                const foeSeedHex = await sha256Hex(currentGlobalSeedHex + `::foe::${i}`);
                const foeSeedInt = hexToSeedInt(foeSeedHex);
                const pr = mulberry32(foeSeedInt);

                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                const vx = (pr() - 0.5) * 0.7 * 80;
                const vz = (pr() - 0.5) * 0.7 * 80;
                const hue = pr();

                const mat = new THREE.MeshBasicMaterial({
                    map: foeTex,
                    transparent: true,
                    color: new THREE.Color().setHSL(hue, 0.8, 0.5)
                });
                mat.userData = { hue };

                const mesh = new THREE.Mesh(entityGeo, mat);
                mesh.position.set(x, 1, z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                entities.push({ mesh, type: 'foe', id: `foe${i}`, velocity: new THREE.Vector3(vx, 0, vz), hue });
                scene.add(mesh);
            }

            // spawn food
            for (let i = 0; i < foodCount; i++) {
                const foodSeedHex = await sha256Hex(currentGlobalSeedHex + `::food::${i}`);
                const foodSeedInt = hexToSeedInt(foodSeedHex);
                const pr = mulberry32(foodSeedInt);

                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                const vx = (pr() - 0.5) * 0.4 * 80;
                const vz = (pr() - 0.5) * 0.4 * 80;
                const hue = pr();

                const mat = new THREE.MeshBasicMaterial({
                    map: foodTex,
                    transparent: true,
                    color: new THREE.Color().setHSL(hue, 0.8, 0.5)
                });
                mat.userData = { hue };

                const mesh = new THREE.Mesh(entityGeo, mat);
                mesh.position.set(x, 1, z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                entities.push({ mesh, type: 'food', id: `food${i}`, velocity: new THREE.Vector3(vx, 0, vz), hue });
                scene.add(mesh);
            }

            console.log(`[${new Date().toLocaleTimeString()}] spawn complete — total entities: ${entities.length}`);
            for (const e of entities) {
                console.log(`  ${e.type} ${e.id}: (${e.mesh.position.x.toFixed(2)}, ${e.mesh.position.z.toFixed(2)})`);
            }
        }

        // --------------------
        // Simulation loop (restored collision & logic)
        // --------------------
        const TIME_STEP = 0.016; // fixed-step
        let lastTime = getSyncedTime();

        function animate() {
            requestAnimationFrame(animate);

            const now = getSyncedTime();
            let delta = now - lastTime;
            while (delta >= TIME_STEP) {
                updateSimulation(TIME_STEP);
                delta -= TIME_STEP;
                lastTime += TIME_STEP;
            }
            // keep lastTime close to now (avoid huge catch-up)
            lastTime = now - delta;

            renderer.render(scene, camera);
        }

        function updateSimulation(dt) {
            // Move entities
            for (const e of entities) {
                // position += velocity * dt
                e.mesh.position.add(e.velocity.clone().multiplyScalar(dt));
                e.mesh.rotation.y += 0.01;

                // if user entity, update color lightness based on health
                if (e.type === 'user' && typeof e.health === 'number') {
                    const baseHue = (typeof e.hue === 'number') ? e.hue : (e.mesh.material && e.mesh.material.userData && e.mesh.material.userData.hue) || 0;
                    const sat = 0.8;
                    // clamp health 0..3
                    const health = Math.max(0, Math.min(3, e.health));
                    // map health to lightness between 0.3 and 0.6
                    const lightness = 0.3 + (health / 3) * 0.3;
                    if (e.mesh.material && typeof e.mesh.material.setHSL === 'function') {
                        // some Three versions don't have setHSL on material — use color
                        try {
                            e.mesh.material.color.setHSL(baseHue, sat, lightness);
                        } catch (err) {
                            e.mesh.material.color = new THREE.Color().setHSL(baseHue, sat, lightness);
                        }
                    } else {
                        e.mesh.material.color = new THREE.Color().setHSL(baseHue, sat, lightness);
                    }
                }
            }

            // Collisions (AABB) and interactions
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const A = entities[i], B = entities[j];
                    // AABB
                    const boxA = new THREE.Box3().setFromObject(A.mesh);
                    const boxB = new THREE.Box3().setFromObject(B.mesh);
                    if (!boxA.intersectsBox(boxB)) continue;

                    // Swap velocities
                    const tmp = A.velocity.clone();
                    A.velocity.copy(B.velocity);
                    B.velocity.copy(tmp);

                    // interactions
                    // user <-> foe
                    if (A.type === 'user' && B.type === 'foe') {
                        A.health = (A.health || 3) - 2;
                        try { scene.remove(B.mesh); } catch (e) {}
                        entities.splice(j, 1); j--;
                        continue;
                    }
                    if (A.type === 'foe' && B.type === 'user') {
                        B.health = (B.health || 3) - 2;
                        try { scene.remove(A.mesh); } catch (e) {}
                        entities.splice(i, 1); i--; break;
                    }

                    // user <-> food
                    if (A.type === 'user' && B.type === 'food') {
                        A.health = (A.health || 3) + 1;
                        try { scene.remove(B.mesh); } catch (e) {}
                        entities.splice(j, 1); j--;
                        continue;
                    }
                    if (A.type === 'food' && B.type === 'user') {
                        B.health = (B.health || 3) + 1;
                        try { scene.remove(A.mesh); } catch (e) {}
                        entities.splice(i, 1); i--; break;
                    }

                    // user <-> user
                    if (A.type === 'user' && B.type === 'user') {
                        A.health = (A.health || 3) - 1;
                        B.health = (B.health || 3) - 1;
                    }
                }
            }

            // Bounds bounce
            for (const e of entities) {
                if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
            }

            // Remove dead users
            for (let i = entities.length - 1; i >= 0; i--) {
                const e = entities[i];
                if (e.type === 'user' && (e.health || 0) <= 0) {
                    knownUsers.delete(e.id);
                    try { scene.remove(e.mesh); } catch (err) {}
                    entities.splice(i, 1);
                }
            }
        }

        animate();

        // --------------------
        // Chat command detection
        // --------------------
        const startRegex = /^\/startgame\s+(.+)$/i;

        function processCommandText(text, username) {
            if (!text) return;
            const m = text.trim().match(startRegex);
            if (!m) return;
            const seed = m[1].trim();
            console.log(`[${new Date().toLocaleTimeString()}] Detected /startgame "${seed}" from ${username || 'unknown'}`);
            spawnDeterministic(seed).catch(err => console.error('spawn error', err));
        }

        // socket hook(s)
        try {
            if (window.socket && typeof window.socket.on === "function") {
                const tryNames = ['chatMsg', 'chat message', 'chat message new', 'chat'];
                for (const ev of tryNames) {
                    try {
                        window.socket.on(ev, (data) => {
                            try {
                                if (data && typeof data === 'object') {
                                    if (typeof data.msg === 'string') processCommandText(data.msg, data.username || data.user || 'socket');
                                    else if (typeof data.message === 'string') processCommandText(data.message, data.username || data.user || 'socket');
                                } else if (typeof data === 'string') processCommandText(data, 'socket');
                            } catch (e) {}
                        });
                    } catch (e) {}
                }
                console.log('Socket chat listener installed');
            }
        } catch (e) {
            console.warn('Socket not accessible:', e);
        }

        // MutationObserver fallback (chat DOM)
        const bodyObs = new MutationObserver(muts => {
            for (const mut of muts) {
                for (const node of mut.addedNodes) {
                    try {
                        if (!node) continue;
                        if (node.nodeType === Node.TEXT_NODE) processCommandText(node.textContent, 'dom');
                        else if (node.nodeType === Node.ELEMENT_NODE) {
                            const txt = (node.textContent || node.innerText || '').trim();
                            if (startRegex.test(txt)) processCommandText(txt, 'dom');

                            // specific chat msg structure
                            if (node.classList && node.classList.toString().startsWith('chat-msg-')) {
                                const usernameEl = node.querySelector('.username');
                                const username = usernameEl ? usernameEl.textContent.replace(':', '').trim() : 'unknown';
                                const msgSpan = node.querySelector('span:last-child');
                                const text = msgSpan ? msgSpan.textContent.trim() : '';
                                processCommandText(text, username);
                            }
                        }
                    } catch (e) {}
                }
            }
        });
        bodyObs.observe(document.getElementById('messagebuffer') || document.body, { childList: true, subtree: true });

        window.CBT_start = seed => {
            if (!seed) return console.warn('Usage: CBT_start("seed")');
            processCommandText(`/startgame ${seed}`, 'console');
        };

        console.log(`[${new Date().toLocaleTimeString()}] CyTube BattleTanks deterministic script loaded. Type "/startgame <seed>" in chat to spawn.`);
    }

    main().catch(err => console.error("BattleTanks init error", err));
})();
