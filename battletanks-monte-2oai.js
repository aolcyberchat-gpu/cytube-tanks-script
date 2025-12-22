(function () {
    'use strict';
    // CyTube BattleTanks — Deterministic /startgame
    // Patched: event logging, final-state canonical hash, export + verification (CBT_exportProof / CBT_verifyProof)
    // Keep Three.js loader pointing to a CDN allowed by CyTube
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

    // Configuration
    const TIME_STEP = 0.016;
    const MAX_MINUTES = 40;
    const MAX_TICKS = Math.round((MAX_MINUTES * 60) / TIME_STEP);
    const TICK_PRECISION = 3;

    const EVENT_LOG = [];
    let currentTick = 0;

    function roundN(n) {
        const p = Math.pow(10, TICK_PRECISION);
        return Math.round(n * p) / p;
    }

    function recordEvent(type, data) {
        EVENT_LOG.push({ tick: currentTick, type, data });
    }

    function recordSpawn(ent) {
        recordEvent('spawn', {
            id: String(ent.id),
            t: ent.type,
            x: roundN(ent.mesh.position.x),
            z: roundN(ent.mesh.position.z),
            vx: roundN(ent.velocity.x),
            vz: roundN(ent.velocity.z),
            hp: ent.health === undefined ? null : ent.health
        });
    }

    function recordCollision(a, b) {
        recordEvent('collision', {
            a: String(a.id), ta: a.type, ahp: a.health === undefined ? null : a.health,
            b: String(b.id), tb: b.type, bhp: b.health === undefined ? null : b.health
        });
    }

    function recordRemove(ent, reason) {
        recordEvent('remove', {
            id: String(ent.id), t: ent.type, reason: String(reason)
        });
    }

    function recordFinalSnapshot() {
        const snap = entities.map(e => ({
            id: String(e.id),
            t: e.type,
            x: roundN(e.mesh.position.x),
            z: roundN(e.mesh.position.z),
            hp: e.health === undefined ? null : e.health
        })).sort((A, B) => (A.t + A.id).localeCompare(B.t + B.id));
        recordEvent('finalSnapshot', { totalTicks: currentTick, snapshot: snap });
    }

    async function computeFinalHash(room, seedWord, usernames) {
        const canonical = {
            meta: { room: String(room), seed: String(seedWord), users: Array.from(usernames).map(String).sort() },
            events: EVENT_LOG
        };
        const json = JSON.stringify(canonical);
        const hash = await sha256Hex(json);
        return { hash, json, canonical };
    }

    async function main() {
        await syncTime();
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

        window.renderer = renderer;
        window.scene = scene;
        window.camera = camera;

        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const terrainMat = new THREE.MeshBasicMaterial({ color: 0x00aa88, wireframe: true });
        const terrain = new THREE.Mesh(terrainGeo, terrainMat);
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

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
        window.entities = entities;

        function clearEntities() {
            while (entities.length) {
                const e = entities.pop();
                try { scene.remove(e.mesh); } catch (err) {}
            }
            knownUsers.clear();
            EVENT_LOG.length = 0;
            currentTick = 0;
            console.log(`[${new Date().toLocaleTimeString()}] cleared entities`);
        }

        function roomNameFromPath() {
            const parts = (window.location.pathname || '').split('/');
            return parts[parts.length - 1] || 'room';
        }

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

        let currentGlobalSeedHex = null;
        let globalPRNG = null;
        let lastSpawnInfo = null;

        async function spawnDeterministic(seedWord, { autoExportOnEnd = true } = {}) {
            currentTick = 0;
            EVENT_LOG.length = 0;

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
            lastSpawnInfo = { room, seedWord, usernames: usernames.slice(), counts: { players: playerCount, foes: foeCount, food: foodCount } };

            // Spawn players (faster velocity)
            for (let i = 0; i < playerCount; i++) {
                const uname = usernames[i % usernames.length] || `player${i}`;
                const perUserSeedHex = await sha256Hex(currentGlobalSeedHex + '::user::' + uname);
                const perUserSeedInt = hexToSeedInt(perUserSeedHex);
                const userPRNG = mulberry32(perUserSeedInt);

                const ux = (userPRNG() - 0.5) * 80;
                const uz = (userPRNG() - 0.5) * 80;
                const uvx = (userPRNG() - 0.5) * 0.7 * 2.5;
                const uvz = (userPRNG() - 0.5) * 0.7 * 2.5;

                const mesh = new THREE.Mesh(entityGeo, userMat);
                mesh.position.set(ux, 1, uz);

                const ent = { mesh, type: 'user', id: uname, velocity: new THREE.Vector3(uvx, 0, uvz), health: 3 };
                scene.add(mesh);
                entities.push(ent);
                knownUsers.set(uname, ent);
                recordSpawn(ent);
            }

            // Spawn foes (faster)
            for (let i = 0; i < foeCount; i++) {
                const foeSeedHex = await sha256Hex(currentGlobalSeedHex + `::foe::${i}`);
                const foeSeedInt = hexToSeedInt(foeSeedHex);
                const pr = mulberry32(foeSeedInt);

                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                const vx = (pr() - 0.5) * 0.7 * 3.5;
                const vz = (pr() - 0.5) * 0.7 * 3.5;

                const mesh = new THREE.Mesh(entityGeo, foeMat);
                mesh.position.set(x, 1, z);
                const ent = { mesh, type: 'foe', id: `foe${i}`, velocity: new THREE.Vector3(vx, 0, vz) };
                entities.push(ent);
                scene.add(mesh);
                recordSpawn(ent);
            }

            // Spawn food (faster)
            for (let i = 0; i < foodCount; i++) {
                const foodSeedHex = await sha256Hex(currentGlobalSeedHex + `::food::${i}`);
                const foodSeedInt = hexToSeedInt(foodSeedHex);
                const pr = mulberry32(foodSeedInt);

                const x = (pr() - 0.5) * 80;
                const z = (pr() - 0.5) * 80;
                const vx = (pr() - 0.5) * 0.4 * 2.5;
                const vz = (pr() - 0.5) * 0.4 * 2.5;

                const mesh = new THREE.Mesh(entityGeo, foodMat);
                mesh.position.set(x, 1, z);
                const ent = { mesh, type: 'food', id: `food${i}`, velocity: new THREE.Vector3(vx, 0, vz) };
                entities.push(ent);
                scene.add(mesh);
                recordSpawn(ent);
            }

            recordEvent('spawnMeta', { room, seedWord, usernames: lastSpawnInfo.usernames, counts: lastSpawnInfo.counts });
            console.log(`[${new Date().toLocaleTimeString()}] spawn complete — total entities: ${entities.length}`);
            return { room, seedWord, usernames: lastSpawnInfo.usernames };
        }

        let lastFrameTime = getSyncedTime();
        function animate() {
            requestAnimationFrame(animate);
            const now = getSyncedTime();
            let delta = now - lastFrameTime;
            while (delta >= TIME_STEP) {
                updateSimulation(TIME_STEP);
                delta -= TIME_STEP;
            }
            lastFrameTime = now - delta;
            renderer.render(scene, camera);
        }

        function updateSimulation(dt) {
            currentTick++;
            for (const e of entities) {
                e.mesh.position.add(e.velocity.clone().multiplyScalar(dt));
                e.mesh.rotation.y += 0.01;
                if (e.type === 'user' && e.health !== undefined) {
                    try {
                        e.mesh.material.color.setHSL((e.health / 3) * 0.3, 0.8, 0.5);
                    } catch (err) {}
                }
            }

            // collisions
            for (let i = 0; i < entities.length; i++) {
                for (let j = i + 1; j < entities.length; j++) {
                    const A = entities[i], B = entities[j];
                    const boxA = new THREE.Box3().setFromObject(A.mesh);
                    const boxB = new THREE.Box3().setFromObject(B.mesh);
                    if (!boxA.intersectsBox(boxB)) continue;
                    recordCollision(A, B);

                    const tmp = A.velocity.clone();
                    A.velocity.copy(B.velocity);
                    B.velocity.copy(tmp);

                    if (A.type === 'user' && B.type === 'foe') {
                        A.health -= 2;
                        try { scene.remove(B.mesh); } catch (err) {}
                        entities.splice(j, 1);
                        recordRemove(B, 'killed-by-user');
                        j--;
                        continue;
                    }
                    if (A.type === 'foe' && B.type === 'user') {
                        B.health -= 2;
                        try { scene.remove(A.mesh); } catch (err) {}
                        entities.splice(i, 1);
                        recordRemove(A, 'killed-by-user');
                        i--;
                        break;
                    }
                    if (A.type === 'user' && B.type === 'food') {
                        A.health += 1;
                        try { scene.remove(B.mesh); } catch (err) {}
                        entities.splice(j, 1);
                        recordRemove(B, 'eaten-by-user');
                        j--;
                        continue;
                    }
                    if (A.type === 'food' && B.type === 'user') {
                        B.health += 1;
                        try { scene.remove(A.mesh); } catch (err) {}
                        entities.splice(i, 1);
                        recordRemove(A, 'eaten-by-user');
                        i--;
                        break;
                    }
                    if (A.type === 'user' && B.type === 'user') {
                        A.health -= 1;
                        B.health -= 1;
                    }
                }
            }

            for (const e of entities) {
                if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
            }

            for (let i = entities.length - 1; i >= 0; i--) {
                const e = entities[i];
                if (e.type === 'user' && e.health <= 0) {
                    knownUsers.delete(e.id);
                    try { scene.remove(e.mesh); } catch (err) {}
                    entities.splice(i, 1);
                    recordRemove(e, 'user-dead');
                }
            }

            const totalEntities = entities.length;
            if (totalEntities <= 1 || currentTick >= MAX_TICKS) {
                recordFinalSnapshot();
                (async () => {
                    try {
                        const metaRoom = lastSpawnInfo ? lastSpawnInfo.room : roomNameFromPath();
                        const metaSeed = lastSpawnInfo ? lastSpawnInfo.seedWord : 'unknown';
                        const metaUsers = lastSpawnInfo ? lastSpawnInfo.usernames : getSanitizedUsernames();
                        const result = await computeFinalHash(metaRoom, metaSeed, metaUsers);
                        console.log('[CBT] Match end — finalHash:', result.hash);
                        const blob = new Blob([result.json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `battle-proof-${result.hash}.json`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                    } catch (err) {
                        console.error('[CBT] export failed', err);
                    }
                })();
                lastSpawnInfo = null;
            }
        }

        animate();

        const startRegex = /^\/startgame\s+(.+)$/i;

        function processCommandText(text, username) {
            if (!text) return;
