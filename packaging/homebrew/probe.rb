# Lives in ninhache/homebrew-tap as Formula/probe.rb. Kept here as the reference copy.
# url and sha256 change at each release: see the homebrew job in .github/workflows/release.yml.
class Probe < Formula
  desc "Health checks for local dev services, from the CLI or a Makefile"
  homepage "https://github.com/Ninhache/probe"
  url "https://registry.npmjs.org/@ninhache/probe/-/probe-0.1.0.tgz"
  sha256 "da02a97463c3257edcdb4fc8ebdb8127449f68787ba053be6bface164ef434cd"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/probe --version")
  end
end
