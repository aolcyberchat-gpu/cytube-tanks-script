// ==UserScript==
// @name         CyTube BattleTanks — Deterministic /startgame
// @namespace    http://www.cytu.be
// @version      1.0.13
// @description  Deterministic tanks/foes/food using /startgame <seed> on cytu.be rooms.
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

        window.addEventListener('resize', () => {
            renderer.setSize(window.innerWidth, window.innerHeight);
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        });

        const terrainGeo = new THREE.PlaneGeometry(100, 100, 60, 60);
        const loader = new THREE.TextureLoader();
        const terrainTex = loader.load('https://i.ibb.co/LBGxqDV/terrian-level-001.gif');
        const terrainMat = new THREE.MeshBasicMaterial({ map: terrainTex });
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

        function clearEntities() {
            while (entities.length) {
                const e = entities.pop();
                scene.remove(e.mesh);
            }
            knownUsers.clear();
        }

        function createTextLabel(text) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = 'Bold 20px Arial';
            canvas.width = ctx.measureText(text).width + 10;
            canvas.height = 30;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.fillText(text, 5, 20);

            const tex = new THREE.Texture(canvas);
            tex.needsUpdate = true;
            const mat = new THREE.SpriteMaterial({ map: tex });
            const spr = new THREE.Sprite(mat);
            spr.scale.set(canvas.width / 10, canvas.height / 10, 1);
            return spr;
        }

        const startRegex = /^\/startgame\s+(.+)$/i;
        const moveRegex = /^\/([wasd])$/i;

        function logMoveCommand(username, key) {
            const ent = knownUsers.get(username);
            console.log(
                `[INPUT] user="${username}" cmd="/${key}" entity=${!!ent} type=${ent ? ent.type : 'n/a'}`
            );
        }

        async function spawnDeterministic(seedWord) {
            clearEntities();

            const room = location.pathname.split('/').pop();
            const seedHex = await sha256Hex(`${room}:${seedWord}`);
            const rng = mulberry32(hexToSeedInt(seedHex));

            const users = [...document.querySelectorAll('#userlist .userlist_item span:nth-of-type(2)')]
                .map(s => s.textContent.trim())
                .sort();

            users.forEach(async uname => {
                const uHex = await sha256Hex(seedHex + uname);
                const pr = mulberry32(hexToSeedInt(uHex));
                const mesh = new THREE.Mesh(entityGeo, userMatGreen);
                mesh.position.set((pr() - 0.5) * 80, 1, (pr() - 0.5) * 80);

                const label = createTextLabel(uname);
                label.position.set(0, 4, 0);
                mesh.add(label);

                const ent = { mesh, type: 'user', id: uname, health: 3, velocity: new THREE.Vector3() };
                entities.push(ent);
                knownUsers.set(uname, ent);
                scene.add(mesh);
            });
        }

        function processCommandText(text, username) {
            if (!text) return;
            const t = text.trim();

            const sg = t.match(startRegex);
            if (sg) return spawnDeterministic(sg[1]);

            const mv = t.match(moveRegex);
            if (mv && username) logMoveCommand(username, mv[1].toLowerCase());
        }

        if (window.socket?.on) {
            window.socket.on('chatMsg', data => {
                processCommandText(data.msg, data.username || data.name);
            });
        }

        function animate() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        }
        animate();

        console.log('BattleTanks loaded with chat logging enabled.');
    }

    main();
})();
