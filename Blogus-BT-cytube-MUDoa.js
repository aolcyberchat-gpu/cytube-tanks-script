// ==UserScript==
// @name         CyTube BattleTanks — Deterministic /startgame with collisions (integer-tick slowed)
// @namespace    http://www.cytu.be
// @version      1.0.14
// @description  Deterministic tanks/foes/food using /startgame <seed>, integer grid movement, throttled ticks
// @author       Guy McFurry III (adapted)
// @match        https://cytu.be/r/BLOGUS
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

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
        await loadThree();

        const MOVE_EVERY_N_TICKS = 8; // ← speed control
        let tickCounter = 0;

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
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 20, 40);
        camera.lookAt(0, 0, 0);

        const terrainGeo = new THREE.PlaneGeometry(100, 100);
        const loader = new THREE.TextureLoader();
        const terrainTex = loader.load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif');
        const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshBasicMaterial({ map: terrainTex }));
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

        function getUsernames() {
            return Array.from(
                new Set(
                    [...document.querySelectorAll('#userlist .userlist_item span:nth-of-type(2)')]
                        .map(e => e.textContent.trim())
                        .filter(Boolean)
                )
            ).sort();
        }

        async function spawnDeterministic(seedWord) {
            entities.length = 0;
            knownUsers.clear();
            scene.children = scene.children.filter(o => o === terrain || o.type === 'AmbientLight');

            const room = location.pathname.split('/').pop();
            const globalSeed = await sha256Hex(room + ':' + seedWord);
            const usernames = getUsernames();

            for (const uname of usernames) {
                const prng = mulberry32(hexToSeedInt(await sha256Hex(globalSeed + uname)));
                const mesh = new THREE.Mesh(entityGeo, userMatGreen);
                mesh.position.set(
                    Math.round((prng() - 0.5) * 80),
                    1,
                    Math.round((prng() - 0.5) * 80)
                );

                const velocity = new THREE.Vector3(
                    prng() > 0.5 ? 1 : -1,
                    0,
                    prng() > 0.5 ? 1 : -1
                );

                entities.push({ type: 'user', id: uname, mesh, velocity, health: 3 });
                knownUsers.set(uname, entities.at(-1));
                scene.add(mesh);
            }
        }

        function animate() {
            requestAnimationFrame(animate);
            tickCounter++;

            if (tickCounter % MOVE_EVERY_N_TICKS === 0) {
                for (const e of entities) {
                    e.mesh.position.add(e.velocity);

                    if (e.mesh.position.x > 49 || e.mesh.position.x < -49) e.velocity.x *= -1;
                    if (e.mesh.position.z > 49 || e.mesh.position.z < -49) e.velocity.z *= -1;
                }
            }

            renderer.render(scene, camera);
        }

        animate();

        window.socket?.on?.('chatMsg', data => {
            const m = data?.msg?.match(/^\/startgame\s+(.+)/i);
            if (m) spawnDeterministic(m[1]);
        });

        console.log('[BattleTanks] Loaded — movement throttled.');
    }

    main();
})();
