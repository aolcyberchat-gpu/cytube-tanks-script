// ==UserScript==
// @name         CyTube BattleTanks — Deterministic Integer Engine (Restored + Slowed)
// @namespace    http://www.cytu.be
// @version      1.0.15
// @description  Tanks, foes, food, username labels, integer movement, slowed ticks
// @match        https://cytu.be/r/BLOGUS
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const MOVE_EVERY_N_TICKS = 8; // speed control
    let tickCounter = 0;

    /* ------------------ Three.js loader ------------------ */
    function loadThree() {
        return new Promise(resolve => {
            if (window.THREE) return resolve();
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js';
            s.onload = resolve;
            document.head.appendChild(s);
        });
    }

    /* ------------------ Deterministic RNG ------------------ */
    function mulberry32(a) {
        return function () {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    async function shaSeed(str) {
        const buf = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(str)
        );
        return new Uint32Array(buf)[0];
    }

    /* ------------------ Username label ------------------ */
    function makeLabel(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.font = '28px monospace';
        ctx.fillStyle = '#00ffcc';
        ctx.textAlign = 'center';
        ctx.fillText(name, 128, 40);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(10, 2.5, 1);
        sprite.position.y = 4;

        return sprite;
    }

    /* ------------------ Main ------------------ */
    async function main() {
        await loadThree();

        /* Renderer */
        const canvas = document.createElement('canvas');
        Object.assign(canvas.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '-1',
            pointerEvents: 'none'
        });
        document.body.appendChild(canvas);

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
        renderer.setSize(innerWidth, innerHeight);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
        camera.position.set(0, 30, 45);
        camera.lookAt(0, 0, 0);

        scene.add(new THREE.AmbientLight(0xffffff));

        /* Terrain */
        const terrain = new THREE.Mesh(
            new THREE.PlaneGeometry(100, 100),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif')
            })
        );
        terrain.rotation.x = -Math.PI / 2;
        scene.add(terrain);

        /* Textures */
        const loader = new THREE.TextureLoader();
        const tankMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/WQ9Py5J/Apu-Radio-Its-Over.webp') });
        const foeMat  = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/MkG52QDN/Blogus-Foe.webp') });
        const foodMat = new THREE.MeshBasicMaterial({ map: loader.load('https://i.ibb.co/chvzwJhg/Food-Burger.webp') });

        const geo = new THREE.BoxGeometry(2, 3, 2);
        const entities = [];

        function spawnEntity(mat, rng, type, name = null) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(
                Math.round((rng() - 0.5) * 80),
                1,
                Math.round((rng() - 0.5) * 80)
            );

            const velocity = new THREE.Vector3(
                rng() > 0.5 ? 1 : -1,
                0,
                rng() > 0.5 ? 1 : -1
            );

            if (name) {
                const label = makeLabel(name);
                mesh.add(label);
            }

            scene.add(mesh);
            entities.push({ mesh, velocity, type });
        }

        async function startGame(seedWord) {
            entities.length = 0;
            scene.children = scene.children.filter(o => o === terrain || o.type === 'AmbientLight');

            const room = location.pathname.split('/').pop();
            const baseSeed = await shaSeed(room + ':' + seedWord);

            /* Users */
            const names = [...document.querySelectorAll('#userlist .userlist_item span:nth-child(2)')]
                .map(n => n.textContent.trim())
                .filter(Boolean)
                .sort();

            names.forEach((name, i) => {
                const rng = mulberry32(baseSeed + i);
                spawnEntity(tankMat, rng, 'tank', name);
            });

            /* Foes */
            for (let i = 0; i < 6; i++) {
                spawnEntity(foeMat, mulberry32(baseSeed + 1000 + i), 'foe');
            }

            /* Food */
            for (let i = 0; i < 8; i++) {
                spawnEntity(foodMat, mulberry32(baseSeed + 2000 + i), 'food');
            }
        }

        /* ------------------ Animation ------------------ */
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

        /* Chat command */
        window.socket?.on?.('chatMsg', data => {
            const m = data.msg?.match(/^\/startgame\s+(.+)/i);
            if (m) startGame(m[1]);
        });

        console.log('[BattleTanks] Fully restored, slowed, deterministic.');
    }

    main();
})();
