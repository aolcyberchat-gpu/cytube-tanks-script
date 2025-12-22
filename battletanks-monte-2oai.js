(function () {
    'use strict';

    // ===============================
    // CyTube BattleTanks (Deterministic)
    // ===============================

    const SPEED_MULTIPLIER = 6.0; // <<< SPEED FIX

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
        const data = new TextEncoder().encode(str);
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

    const TIME_STEP = 0.016;
    const MAX_MINUTES = 40;
    const MAX_TICKS = Math.round((MAX_MINUTES * 60) / TIME_STEP);

    const EVENT_LOG = [];
    let currentTick = 0;

    async function main() {
        await loadThree();

        // --- Canvas ---
        const canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.zIndex = '-1';
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
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

        // --- Terrain ---
        const terrain = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100, 60, 60),
            new THREE.MeshBasicMaterial({ wireframe: true, color: 0x00aa88 })
        );
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);
        scene.add(new THREE.AmbientLight(0xffffff));

        // --- Assets ---
        const loader = new THREE.TextureLoader();
        const userMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp'), transparent: true });
        const foeMat  = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp'), transparent: true });
        const foodMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp'), transparent: true });

        const entityGeo = new THREE.BoxGeometry(2, 3, 2);
        const entities = [];

        function roomName() {
            return location.pathname.split('/').pop() || 'room';
        }

        function getUsers() {
            return [...document.querySelectorAll('#userlist .userlist_item span:nth-of-type(2)')]
                .map(e => e.textContent.trim())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }

        async function spawn(seedWord) {
            entities.length = 0;
            currentTick = 0;

            const room = roomName();
            const users = getUsers();
            const playerCount = Math.max(1, users.length);

            const seedHex = await sha256Hex(`${room}:${seedWord}`);
            const rng = mulberry32(hexToSeedInt(seedHex));

            // --- Players ---
            for (const name of users) {
                const mesh = new THREE.Mesh(entityGeo, userMat);
                mesh.position.set((rng() - 0.5) * 80, 1, (rng() - 0.5) * 80);
                scene.add(mesh);
                entities.push({
                    id: name,
                    type: 'user',
                    mesh,
                    health: 3,
                    velocity: new THREE.Vector3((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7)
                });
            }

            // --- Foes ---
            for (let i = 0; i < Math.max(4, playerCount); i++) {
                const mesh = new THREE.Mesh(entityGeo, foeMat);
                mesh.position.set((rng() - 0.5) * 80, 1, (rng() - 0.5) * 80);
                scene.add(mesh);
                entities.push({
                    id: `foe${i}`,
                    type: 'foe',
                    mesh,
                    velocity: new THREE.Vector3((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7)
                });
            }

            // --- Food ---
            for (let i = 0; i < Math.max(4, Math.floor(playerCount * 0.8)); i++) {
                const mesh = new THREE.Mesh(entityGeo, foodMat);
                mesh.position.set((rng() - 0.5) * 80, 1, (rng() - 0.5) * 80);
                scene.add(mesh);
                entities.push({
                    id: `food${i}`,
                    type: 'food',
                    mesh,
                    velocity: new THREE.Vector3((rng() - 0.5) * 0.4, 0, (rng() - 0.5) * 0.4)
                });
            }
        }

        let last = performance.now();

        function animate(now) {
            requestAnimationFrame(animate);
            let delta = (now - last) / 1000;

            while (delta >= TIME_STEP) {
                update(TIME_STEP);
                delta -= TIME_STEP;
            }

            last = now;
            renderer.render(scene, camera);
        }

        function update(dt) {
            currentTick++;

            for (const e of entities) {
                e.mesh.position.add(
                    e.velocity.clone().multiplyScalar(dt * SPEED_MULTIPLIER)
                );
                e.mesh.rotation.y += 0.01;

                if (e.type === 'user') {
                    e.mesh.material.color.setHSL((e.health / 3) * 0.3, 0.8, 0.5);
                }

                if (Math.abs(e.mesh.position.x) > 49) e.velocity.x *= -1;
                if (Math.abs(e.mesh.position.z) > 49) e.velocity.z *= -1;
            }
        }

        animate(performance.now());

        const cmd = /^\/startgame\s+(.+)$/i;
        window.socket?.on?.('chatMsg', d => {
            const m = d.msg?.match(cmd);
            if (m) spawn(m[1]);
        });

        console.log('[BattleTanks] Loaded. Use /startgame <seed>');
    }

    main();
})();
