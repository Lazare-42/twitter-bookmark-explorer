{
  description = "bookmarks-lazare — Twitter bookmarks explorer by theme (Next.js standalone)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;
      pkgsFor = s: nixpkgs.legacyPackages.${s};

      mkFrontend = pkgs: pkgs.buildNpmPackage {
        pname = "bookmarks-lazare";
        version = "0.1.0";
        src = ./frontend;
        npmDepsHash = "sha256-efKgcgJU3R8W5zgwjKZHTiJXXkbM8SnXhdQOL/zaABE=";
        nativeBuildInputs = [ pkgs.makeWrapper ];
        env.NEXT_TELEMETRY_DISABLED = "1";
        # buildPhase runs `npm run build` (= next build) by default.
        installPhase = ''
          runHook preInstall
          dir=$out/share/bookmarks-lazare
          mkdir -p "$dir"
          cp -r .next/standalone/. "$dir"/
          mkdir -p "$dir/.next"
          cp -r .next/static "$dir/.next/static"
          [ -d public ] && cp -r public "$dir/public" || true
          makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/bookmarks-lazare \
            --add-flags "$dir/server.js"
          runHook postInstall
        '';
      };
    in {
      packages = forAll (s: {
        default = mkFrontend (pkgsFor s);
        bookmarks-lazare = mkFrontend (pkgsFor s);
      });
      overlays.default = final: prev: {
        bookmarks-lazare = self.packages.${final.system}.default;
      };
    };
}
